// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceWatcher } from './use-workspace-watcher'
import { defaultSettings } from '@/lib/settings'
import type { Workspace } from '@/types'

const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api }))
const project = { id: 'root', name: 'Root', dirName: 'root', relativePath: 'root', description: '', stack: [], scripts: {}, packageManager: 'npm' as const, scannedAt: '', packageFingerprint: 'original' }
const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', projects: [project], syncedAt: '' }
const options = () => ({ workspace, settings: { ...defaultSettings, watcherMode: 'periodic' as const, watcherIntervalMinutes: 1 }, busy: false, online: true, run: vi.fn().mockResolvedValue(workspace) })
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => { vi.useFakeTimers(); api.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('workspace watcher scheduling', () => {
  it('never scans or checks for changes in manual mode, offline, or without a directory', async () => {
    const props = options()
    const { rerender } = renderHook(useWorkspaceWatcher, { initialProps: { ...props, settings: defaultSettings, workspace: workspace as Workspace | undefined } })
    await advance(120_000)
    expect(props.run).not.toHaveBeenCalled()
    rerender({ ...props, online: false })
    await advance(120_000)
    rerender({ ...props, workspace: undefined })
    await advance(120_000)
    expect(props.run).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('waits for the interval and for existing work, and never overlaps slow scans', async () => {
    const props = options()
    let finish!: (value: Workspace) => void
    props.run.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { rerender } = renderHook(useWorkspaceWatcher, { initialProps: { ...props, busy: true } })
    await advance(60_000)
    expect(props.run).not.toHaveBeenCalled()
    rerender(props)
    await advance(5000)
    expect(props.run).toHaveBeenCalledOnce()
    await advance(120_000)
    expect(props.run).toHaveBeenCalledOnce()
    await act(async () => { finish(workspace) })
    await advance(59_999)
    expect(props.run).toHaveBeenCalledOnce()
    await advance(1)
    expect(props.run).toHaveBeenCalledTimes(2)
  })

  it('checks only changed repositories, includes monorepo siblings, and retains changes during a scan', async () => {
    const member = { ...project, id: 'member', monorepo: { id: 'root', name: 'Root', relativePath: 'root', packagePath: 'packages/member' } }
    const other = { ...project, id: 'other' }
    const saved = { ...workspace, projects: [project, member, other] }
    const props = { ...options(), workspace: saved, settings: { ...defaultSettings, watcherMode: 'changes' as const } }
    api.mockResolvedValue({ fingerprints: { root: 'original', member: 'original', other: 'original' } })
    const { result } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(0)
    expect(props.run).not.toHaveBeenCalled()
    api.mockResolvedValue({ fingerprints: { root: 'original', member: 'changed', other: 'original' } })
    const scanned = { ...saved, projects: [project, { ...member, packageFingerprint: 'changed' }, other] }
    props.run.mockResolvedValue(scanned)
    await advance(15_000)
    expect(props.run).toHaveBeenCalledWith(['root', 'member'], expect.any(Function), expect.any(Function))
    await advance(15_000)
    expect(props.run).toHaveBeenCalledOnce()
    api.mockResolvedValue({ fingerprints: { root: 'original', member: 'changed-again', other: 'original' } })
    await advance(15_000)
    expect(props.run).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBe(false)
  })

  it.each([
    ['independent', ['independent']],
    ['root', ['root', 'member']],
    ['member', ['root', 'member']],
  ])('keeps undeclared packages independent when %s changes', async (changedId, expectedIds) => {
    const monorepo = { id: 'root', name: 'Root', relativePath: 'root', packagePath: 'frontend' }
    const member = { ...project, id: 'member', monorepo: { ...monorepo, declaredWorkspace: true } }
    const independent = { ...project, id: 'independent', monorepo: { ...monorepo, packagePath: 'independent', declaredWorkspace: false } }
    const saved = { ...workspace, projects: [project, member, independent] }
    const props = { ...options(), workspace: saved, settings: { ...defaultSettings, watcherMode: 'changes' as const } }
    api.mockResolvedValue({ fingerprints: { root: 'original', member: 'original', independent: 'original', [changedId]: 'changed' } })
    props.run.mockResolvedValue({ ...saved, projects: saved.projects.map(item => item.id === changedId ? { ...item, packageFingerprint: 'changed' } : item) })
    renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(0)
    expect(props.run).toHaveBeenCalledExactlyOnceWith(expectedIds, expect.any(Function), expect.any(Function))
    await advance(15_000)
    expect(props.run).toHaveBeenCalledOnce()
  })

  it('uses the latest committed callback without restarting the scheduled interval', async () => {
    const props = options()
    const { rerender } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(30_000)
    const run = vi.fn().mockResolvedValue(workspace)
    rerender({ ...props, workspace: { ...workspace }, run })
    await advance(30_000)
    expect(props.run).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledOnce()
  })

  it('registers a restarted helper, backs off after errors, and retries', async () => {
    const props = { ...options(), settings: { ...defaultSettings, watcherMode: 'changes' as const } }
    api.mockRejectedValueOnce(new Error('Helper offline')).mockResolvedValue({ fingerprints: null })
    const { result } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(0)
    expect(result.current.message).toBe('Helper offline')
    await advance(59_999)
    expect(api).toHaveBeenCalledOnce()
    await advance(1)
    expect(props.run).toHaveBeenCalledWith(undefined, expect.any(Function), expect.any(Function))
  })

  it('gives a manual action priority if it starts during change detection', async () => {
    const props = { ...options(), settings: { ...defaultSettings, watcherMode: 'changes' as const } }
    let finish!: (value: unknown) => void
    api.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ fingerprints: null })
    const { rerender } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(0)
    rerender({ ...props, busy: true })
    await act(async () => { finish({ fingerprints: null }) })
    expect(props.run).not.toHaveBeenCalled()
    rerender(props)
    await advance(5000)
    expect(props.run).toHaveBeenCalledOnce()
  })

  it('cancels queued work when disabled or unmounted without starting another request', async () => {
    const props = options()
    let finish!: (value: Workspace) => void
    props.run.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { rerender, unmount } = renderHook(useWorkspaceWatcher, { initialProps: { ...props, settings: { ...props.settings, watcherMode: 'periodic' as 'periodic' | 'manual' } } })
    await advance(60_000)
    const isCurrent = props.run.mock.calls[0][1] as () => boolean
    expect(isCurrent()).toBe(true)
    rerender({ ...props, settings: defaultSettings })
    expect(isCurrent()).toBe(false)
    await act(async () => { finish(workspace) })
    await advance(120_000)
    expect(props.run).toHaveBeenCalledOnce()
    unmount()
    await advance(120_000)
    expect(props.run).toHaveBeenCalledOnce()
  })

  it('permits periodic browser metadata scans but pauses package-change mode without the helper', async () => {
    const props = { ...options(), workspace: { ...workspace, mode: 'browser' as const }, settings: { ...defaultSettings, watcherMode: 'changes' as 'changes' | 'periodic', watcherIntervalMinutes: 1 } }
    const { result, rerender } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(60_000)
    expect(result.current.message).toContain('requires the local helper')
    expect(api).not.toHaveBeenCalled()
    rerender({ ...props, settings: { ...props.settings, watcherMode: 'periodic' } })
    await advance(60_000)
    expect(props.run).toHaveBeenCalledOnce()
  })

  it('drops an in-flight change check when switching directories and uses the new baseline', async () => {
    const props = { ...options(), settings: { ...defaultSettings, watcherMode: 'changes' as const } }
    let finish!: (value: unknown) => void
    api.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { rerender } = renderHook(useWorkspaceWatcher, { initialProps: props })
    await advance(0)
    expect(api).toHaveBeenCalledWith('/package-changes', { path: '/projects' })
    const next = { ...workspace, rootPath: '/other', projects: [{ ...project, packageFingerprint: 'new-baseline' }] }
    rerender({ ...props, workspace: next })
    await advance(0)
    await act(async () => { finish({ fingerprints: { root: 'stale-change' } }) })
    expect(props.run).not.toHaveBeenCalled()
    api.mockResolvedValue({ fingerprints: { root: 'new-baseline' } })
    await advance(5000)
    expect(api).toHaveBeenLastCalledWith('/package-changes', { path: '/other' })
    expect(props.run).not.toHaveBeenCalled()
    api.mockResolvedValue({ fingerprints: { root: 'changed' } })
    await advance(15_000)
    expect(props.run).toHaveBeenCalledWith(['root'], expect.any(Function), expect.any(Function))
  })
})
