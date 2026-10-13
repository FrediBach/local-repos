// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectDay, projectHistory, projectPushStatus, repositoryDay, repositoryHistory, repositoryPushStatus } from '@/lib/api'
import { loadCommitActivity, saveCommitActivity } from '@/lib/storage'
import { defaultSettings } from '@/lib/settings'
import { useDailySummary } from './use-daily-summary'
import { useCommitActivity } from './use-commit-activity'
import { usePushReminder } from './use-push-reminder'
import type { RepositoryGitHistory, Workspace } from '@/types'

vi.mock('@/lib/api', () => ({ projectDay: vi.fn(), projectHistory: vi.fn(), projectPushStatus: vi.fn(), repositoryDay: vi.fn(), repositoryHistory: vi.fn(), repositoryPushStatus: vi.fn() }))
vi.mock('@/lib/storage', () => ({ loadCommitActivity: vi.fn(), saveCommitActivity: vi.fn() }))

const workspace: Workspace = {
  mode: 'helper', rootPath: '/projects', rootName: 'Projects', rootId: 'root', syncedAt: '2026-10-13T10:00:00Z',
  projects: ['main', 'linked'].map((id, index) => ({
    id, name: 'Same name', dirName: id, relativePath: id, description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { branch: id },
    gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: id, checkoutPath: id, projectPath: '.', role: index ? 'linked' : 'main' },
  })),
}
const scope = { rootId: 'root', repositoryId: 'repo', projectIds: ['main', 'linked'] }
const history: RepositoryGitHistory = { repositoryId: 'repo', coverage: 'complete', available: true, activity: [{ date: '2026-10-13', count: 3 }], from: '2026-01-01', to: '2026-10-13', shallow: false, branches: [], authors: [], commits: [], total: 3, offset: 0, hasMore: false }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.mocked(loadCommitActivity).mockResolvedValue(undefined)
  vi.mocked(saveCommitActivity).mockResolvedValue()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('worktree aggregate workflows', () => {
  it('loads daily history once with the current root and all eligible checkout projects', async () => {
    vi.mocked(repositoryDay).mockResolvedValue({ repositoryId: 'repo', coverage: 'complete', available: true, shallow: false, commits: [] })
    const { result } = renderHook(() => useDailySummary(workspace.projects, true, '2026-10-13', 0, workspace.rootId))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(repositoryDay).toHaveBeenCalledExactlyOnceWith('main', scope, expect.objectContaining({ from: expect.any(String), to: expect.any(String) }))
    expect(projectDay).not.toHaveBeenCalled()
    expect(result.current.results).toHaveLength(1)
  })

  it('stores repository activity once and rejects narrower checkout History callbacks', async () => {
    vi.mocked(repositoryHistory).mockResolvedValue(history)
    const { result } = renderHook(() => useCommitActivity(workspace, workspace))
    await waitFor(() => expect(result.current.activity?.cachedRepositories).toBe(1))
    expect(repositoryHistory).toHaveBeenCalledExactlyOnceWith('main', scope, {})
    expect(projectHistory).not.toHaveBeenCalled()
    expect(saveCommitActivity).toHaveBeenCalledWith(expect.objectContaining({ repositories: { repo: expect.objectContaining({ activity: history.activity }) } }))
    const saves = vi.mocked(saveCommitActivity).mock.calls.length
    act(() => result.current.remember('linked', { ...history, activity: [] }))
    expect(saveCommitActivity).toHaveBeenCalledTimes(saves)
    expect(result.current.projectActivity.main).toEqual(result.current.projectActivity.linked)
  })

  it('does not save an in-flight aggregate after its eligible checkout membership changes', async () => {
    const pending: ((value: RepositoryGitHistory) => void)[] = []
    vi.mocked(repositoryHistory).mockImplementation(() => new Promise(resolve => { pending.push(resolve) }))
    const { rerender } = renderHook(({ current }) => useCommitActivity(current, workspace), { initialProps: { current: workspace } })
    rerender({ current: { ...workspace, ignoredProjectIds: ['linked'] } })
    await act(async () => pending[0](history))
    expect(saveCommitActivity).not.toHaveBeenCalled()
    expect(repositoryHistory).toHaveBeenLastCalledWith('main', { ...scope, projectIds: ['main'] }, {})
    await act(async () => pending[1](history))
    expect(saveCommitActivity).toHaveBeenCalledOnce()
  })

  it('hides incompatible saved counts immediately and refreshes after a checkout is ignored', async () => {
    vi.mocked(loadCommitActivity).mockResolvedValue({ scope: JSON.stringify(['helper', '/projects']), repositories: { repo: { ...history, cachedAt: '2026-10-13T10:00:00Z', membership: JSON.stringify(['linked', 'main']) } } })
    vi.mocked(repositoryHistory).mockRejectedValue(new Error('Temporarily unavailable'))
    const { result, rerender } = renderHook(({ current }) => useCommitActivity(current), { initialProps: { current: workspace } })
    await waitFor(() => expect(result.current.activity?.cachedRepositories).toBe(1))
    expect(repositoryHistory).not.toHaveBeenCalled()
    rerender({ current: { ...workspace, ignoredProjectIds: ['linked'] } })
    expect(result.current.activity).toBeUndefined()
    expect(result.current.projectActivity).toEqual({})
    await waitFor(() => expect(repositoryHistory).toHaveBeenCalledExactlyOnceWith('main', { ...scope, projectIds: ['main'] }, {}))
    rerender({ current: { ...workspace, ignoredProjectIds: ['main', 'linked'] } })
    expect(result.current.activity).toBeUndefined()
    expect(repositoryHistory).toHaveBeenCalledOnce()
  })

  it('keeps checkout coverage when an ignored package still has an eligible sibling package', async () => {
    const packageProject = { ...workspace.projects[0], id: 'package', gitContext: { ...workspace.projects[0].gitContext!, projectPath: 'packages/web' } } as Workspace['projects'][number]
    const packages = { ...workspace, projects: [...workspace.projects, packageProject] }
    vi.mocked(repositoryHistory).mockResolvedValue(history)
    const { result, rerender } = renderHook(({ current }) => useCommitActivity(current, packages), { initialProps: { current: packages } })
    await waitFor(() => expect(result.current.activity?.cachedRepositories).toBe(1))
    rerender({ current: { ...packages, ignoredProjectIds: ['package'] } })
    expect(result.current.activity?.cachedRepositories).toBe(1)
    expect(repositoryHistory).toHaveBeenCalledOnce()
  })

  it('keeps a dirty sibling visible with one shared unpushed count', async () => {
    vi.mocked(repositoryPushStatus).mockResolvedValue({ repositoryId: 'repo', coverage: 'complete', available: true, hasOrigin: true, originRefsKnown: true, unpushedCommits: 1, dirty: true, shallow: false, checkedAt: '', checkouts: [
      { worktreeId: 'main', projectId: 'main', path: 'main', dirty: false },
      { worktreeId: 'linked', projectId: 'linked', path: 'linked', dirty: true },
    ] })
    const { result } = renderHook(() => usePushReminder({ workspace, busy: false, settings: { ...defaultSettings, pushReminderEnabled: true, pushReminderTime: '00:00' } }))
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(repositoryPushStatus).toHaveBeenCalledExactlyOnceWith('main', scope)
    expect(projectPushStatus).not.toHaveBeenCalled()
    expect(result.current.results[0].status?.checkouts?.find(checkout => checkout.dirty)?.projectId).toBe('linked')
  })
})
