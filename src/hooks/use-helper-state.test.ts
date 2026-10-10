// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workspaceHelpers from '@/lib/workspace'
import { useHelperState } from './use-helper-state'
import type { Workspace, WorkspaceState } from '@/types'

const mocks = vi.hoisted(() => ({ api: vi.fn(), registerHelperWorkspace: vi.fn() }))
vi.mock('@/lib/api', () => mocks)
const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', rootId: 'root_a', helperInstanceId: 'boot_a', revision: 1, projects: [], syncedAt: '' }
const snapshot: WorkspaceState = { rootId: 'root_a', helperInstanceId: 'boot_a', revision: 2, resetRequired: false, registered: true, projects: [], activeOperations: [], warnings: [] }
const options = () => ({ workspace, localBusy: '', workspaceVersion: { current: 1 }, persist: vi.fn().mockResolvedValue(true) })
const advance = () => act(() => vi.advanceTimersByTimeAsync(3000))
beforeEach(() => { vi.useFakeTimers(); mocks.api.mockReset().mockResolvedValue(snapshot); mocks.registerHelperWorkspace.mockReset(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('helper workspace synchronization', () => {
  it('persists newer snapshots and exposes external activity without leaking request ownership', async () => {
    const props = options()
    mocks.api.mockResolvedValue({ ...snapshot, activeOperations: [{ operationId: 'op_a', kind: 'check', projectIds: ['project'], progress: { phase: 'Auditing' } }] })
    const { result } = renderHook(useHelperState, { initialProps: props })
    await advance()
    expect(props.persist).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
    expect(result.current.operations[0].progress?.phase).toBe('Auditing')
  })
  it('rejects late responses after a generation change and lower revisions', async () => {
    const props = options()
    let resolve!: (value: WorkspaceState) => void
    mocks.api.mockReturnValueOnce(new Promise(done => { resolve = done }))
    renderHook(useHelperState, { initialProps: props })
    await advance()
    props.workspaceVersion.current++
    await act(async () => resolve(snapshot))
    expect(props.persist).not.toHaveBeenCalled()
    mocks.api.mockResolvedValue({ ...snapshot, revision: 0 })
    await advance()
    expect(props.persist).not.toHaveBeenCalled()
  })
  it('does not poll during local work or while hidden; focus reconciles immediately', async () => {
    const props = options()
    const { rerender } = renderHook(useHelperState, { initialProps: { ...props, localBusy: 'audit' } })
    await advance()
    expect(mocks.api).not.toHaveBeenCalled()
    rerender(props)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await advance()
    expect(mocks.api).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(mocks.api).toHaveBeenCalledOnce()
  })
  it('persists report invalidations even when a changed preview cannot be downloaded', async () => {
    const props = options()
    vi.spyOn(workspaceHelpers, 'cachePreview').mockRejectedValue(new Error('Image unavailable'))
    const project = { id: 'project', name: 'Project', dirName: 'project', relativePath: 'project', description: '', stack: [], scripts: {}, packageManager: 'npm' as const, scannedAt: '', screenshot: '/api/screenshots/project.png', preview: { capturedAt: '2026-10-10', source: 'local' as const }, reportState: { audit: { helperInstanceId: 'boot_a', revision: 2, validity: 'invalidated' as const } } }
    mocks.api.mockResolvedValue({ ...snapshot, projects: [project] })
    const { result } = renderHook(useHelperState, { initialProps: props })
    await advance()
    expect(props.persist).toHaveBeenCalledWith(expect.objectContaining({ projects: [expect.objectContaining({ reportState: project.reportState })] }))
    expect(result.current.error).toContain('preview could not be cached')
  })

  it('re-registers after a helper restart and rejects a pending reply for another workspace', async () => {
    const props = options()
    mocks.api.mockResolvedValue({ ...snapshot, helperInstanceId: 'boot_b', registered: false, resetRequired: true })
    mocks.registerHelperWorkspace.mockResolvedValue({ ...workspace, helperInstanceId: 'boot_b', revision: 1 })
    const { rerender } = renderHook(useHelperState, { initialProps: props })
    await advance()
    expect(mocks.registerHelperWorkspace).toHaveBeenCalledWith('/projects')
    expect(props.persist).toHaveBeenCalledWith(expect.objectContaining({ helperInstanceId: 'boot_b' }))
    props.persist.mockClear()
    let resolve!: (value: WorkspaceState) => void
    mocks.api.mockReturnValueOnce(new Promise(done => { resolve = done }))
    await advance()
    rerender({ ...props, workspace: { ...workspace, rootPath: '/other' } })
    await act(async () => resolve(snapshot))
    expect(props.persist).not.toHaveBeenCalled()
  })
})
