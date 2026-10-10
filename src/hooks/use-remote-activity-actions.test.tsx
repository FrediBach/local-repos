// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useWorkspaceActions } from './use-workspace-actions'
import type { RemoteActivityReport, RepoProject, Workspace } from '../types'

const api = vi.hoisted(() => ({ projectAction: vi.fn(), api: vi.fn(), scanWithHelper: vi.fn() }))
vi.mock('@/lib/api', () => api)
afterEach(() => { cleanup(); vi.resetAllMocks() })
const old: RemoteActivityReport = { repository: 'https://github.com/team/repo', scannedAt: '2026-10-10T10:00:00Z', issues: [1], pullRequests: [2] }
const project: RepoProject = { id: 'one', name: 'One', dirName: 'one', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { origin: old.repository }, remoteActivity: old }
const workspace: Workspace = { mode: 'helper', rootName: 'root', rootPath: '/root', projects: [project, { ...project, id: 'two' }], syncedAt: '' }
const options = () => ({ workspace, busy: '', workspaceVersion: { current: 1 }, setBusy: vi.fn(), setLogs: vi.fn(), setNotice: vi.fn(), setConnectOpen: vi.fn(), persist: vi.fn().mockResolvedValue(true), reportCriticalVulnerabilities: vi.fn() })

describe('repository scan actions', () => {
  it('scans once for shared origins, persists all matching badges and notifies on replacement IDs', async () => {
    const next = { ...old, issues: [3] }
    api.projectAction.mockResolvedValue({ remoteActivity: next })
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(() => result.current.scanAllRemoteActivity())
    expect(api.projectAction).toHaveBeenCalledOnce()
    expect(props.persist.mock.calls[0][0].projects.map((p: RepoProject) => p.remoteActivity)).toEqual([next, next])
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: 'One: 1 newly open issue(s).' })
    expect(result.current.remoteActivityBatch.progress).toMatchObject({ total: 1, completed: 1, withNewItems: 1 })
  })
  it('preserves previous data on failure and does not invent a clean result', async () => {
    api.projectAction.mockRejectedValue(new Error('Rate limited'))
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(() => result.current.action(project, 'remote-activity'))
    expect(props.persist).not.toHaveBeenCalled()
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: 'Rate limited', error: true })
  })
  it('does not apply or notify about late results after switching workspaces', async () => {
    let finish!: (value: unknown) => void
    api.projectAction.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let run!: Promise<void>
    act(() => { run = result.current.action(project, 'remote-activity') })
    props.workspaceVersion.current++
    await act(async () => { finish({ remoteActivity: { ...old, issues: [3] } }); await run })
    expect(props.persist).not.toHaveBeenCalled()
    expect(props.setNotice).not.toHaveBeenCalled()
  })
  it('stops the queue after its current repository and gates browser connections', async () => {
    let finish!: (value: unknown) => void
    api.projectAction.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const props = options()
    props.workspace = { ...workspace, projects: [project, { ...project, id: 'other', git: { origin: 'https://gitlab.com/team/repo' } }] }
    const { result, rerender } = renderHook(() => useWorkspaceActions(props))
    let run!: Promise<void>
    act(() => { run = result.current.scanAllRemoteActivity() })
    act(() => result.current.remoteActivityBatch.stop())
    await act(async () => { finish({ remoteActivity: old }); await run })
    expect(api.projectAction).toHaveBeenCalledOnce()
    expect(result.current.remoteActivityBatch.progress?.status).toBe('stopped')
    props.workspace = { ...workspace, mode: 'browser' }
    rerender()
    await act(() => result.current.scanAllRemoteActivity())
    expect(props.setConnectOpen).toHaveBeenCalledOnce()
    expect(api.projectAction).toHaveBeenCalledOnce()
  })
})
