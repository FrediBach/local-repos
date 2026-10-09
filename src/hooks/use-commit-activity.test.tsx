// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { projectHistory } from '@/lib/api'
import { useCommitActivity } from './use-commit-activity'
import { loadCommitActivity, saveCommitActivity } from '@/lib/storage'
import type { GitHistory, Workspace } from '@/types'
vi.mock('@/lib/api', () => ({ projectHistory: vi.fn() }))
vi.mock('@/lib/storage', () => ({ loadCommitActivity: vi.fn(), saveCommitActivity: vi.fn() }))
const workspace: Workspace = { rootName: 'Projects', rootPath: '/projects', mode: 'helper', syncedAt: '', projects: [{ id: 'root', name: 'Root', dirName: 'root', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { branch: 'main' } }] }
const report: GitHistory = { available: true, activity: [{ date: '2026-10-08', count: 4 }], from: '2026-01-01', to: '2026-10-09', shallow: false, branches: [], authors: [], commits: [], total: 4, offset: 0, hasMore: false }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadCommitActivity).mockResolvedValue(undefined); vi.mocked(saveCommitActivity).mockResolvedValue() })
afterEach(cleanup)
it('loads cached activity without requesting history and saves successful results', async () => {
  vi.mocked(loadCommitActivity).mockResolvedValue({ scope: JSON.stringify(['helper', '/projects']), repositories: { root: { ...report, cachedAt: '2026-10-09T12:00:00Z' } } })
  const { result } = renderHook(() => useCommitActivity(workspace))
  await waitFor(() => expect(result.current.activity?.cachedRepositories).toBe(1))
  act(() => result.current.remember('root', report))
  expect(saveCommitActivity).toHaveBeenCalledWith(expect.objectContaining({ repositories: { root: expect.objectContaining({ activity: report.activity }) } }))
  act(() => result.current.remember('root', { ...report, available: false }))
  expect(saveCommitActivity).toHaveBeenCalledOnce()
})
it('hides old data immediately on directory changes and rejects stale callbacks', async () => {
  const { result, rerender } = renderHook(({ value }) => useCommitActivity(value), { initialProps: { value: workspace } })
  await act(async () => {})
  const oldRemember = result.current.remember
  act(() => oldRemember('root', report))
  rerender({ value: { ...workspace, rootPath: '/different' } })
  expect(result.current.activity).toBeUndefined()
  act(() => oldRemember('root', report))
  expect(saveCommitActivity).toHaveBeenCalledOnce()
})
it('does not let a late cache read overwrite freshly loaded history', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadCommitActivity>>) => void
  vi.mocked(loadCommitActivity).mockImplementation(() => new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useCommitActivity(workspace))
  act(() => result.current.remember('root', report))
  await act(async () => resolve({ scope: JSON.stringify(['helper', '/projects']), repositories: { root: { ...report, activity: [], cachedAt: '2026-10-01T12:00:00Z' } } }))
  expect(saveCommitActivity).toHaveBeenLastCalledWith(expect.objectContaining({ repositories: { root: expect.objectContaining({ activity: report.activity }) } }))
})

it('refreshes once per repository after sync, with at most three requests in flight', async () => {
  const projects = Array.from({ length: 5 }, (_, index) => ({ ...workspace.projects[0], id: `repo-${index}` }))
  const child = { ...projects[0], id: 'child', monorepo: { id: 'repo-0', name: 'Root', relativePath: '.', packagePath: 'child' } }
  const synced = { ...workspace, projects: [...projects, child, { ...projects[0], id: 'no-git', git: undefined }] }
  const pending: ((data: GitHistory) => void)[] = []
  vi.mocked(projectHistory).mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const { rerender } = renderHook(({ snapshot }) => useCommitActivity(synced, snapshot), { initialProps: { snapshot: undefined as Workspace | undefined } })
  await act(async () => {})
  expect(projectHistory).not.toHaveBeenCalled()
  rerender({ snapshot: synced })
  expect(projectHistory).toHaveBeenCalledTimes(3)
  await act(async () => pending[0](report))
  expect(projectHistory).toHaveBeenCalledTimes(4)
  await act(async () => { pending[1](report); pending[2](report) })
  expect(projectHistory).toHaveBeenCalledTimes(5)
  await act(async () => { pending[3](report); pending[4](report) })
  expect(projectHistory).not.toHaveBeenCalledWith('child')
  expect(projectHistory).not.toHaveBeenCalledWith('no-git')
  expect(Object.keys(vi.mocked(saveCommitActivity).mock.calls.at(-1)![0].repositories)).toHaveLength(5)
})

it('retains cached counts after a failed sync history read and skips browser syncing', async () => {
  const { result, rerender } = renderHook(({ value, snapshot }) => useCommitActivity(value, snapshot), { initialProps: { value: workspace, snapshot: undefined as Workspace | undefined } })
  await act(async () => {})
  act(() => result.current.remember('root', report))
  vi.mocked(projectHistory).mockRejectedValue(new Error('History unavailable'))
  rerender({ value: workspace, snapshot: workspace })
  await act(async () => {})
  expect(saveCommitActivity).toHaveBeenCalledOnce()
  expect(result.current.activity?.cachedRepositories).toBe(1)
  const browserWorkspace = { ...workspace, mode: 'browser' as const }
  rerender({ value: browserWorkspace, snapshot: browserWorkspace })
  await act(async () => {})
  expect(projectHistory).toHaveBeenCalledOnce()
})

it('ignores late results from an earlier sync in the same workspace', async () => {
  let finishOld!: (data: GitHistory) => void
  vi.mocked(projectHistory).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  const { rerender } = renderHook(({ snapshot }) => useCommitActivity(workspace, snapshot), { initialProps: { snapshot: workspace } })
  await act(async () => {})
  vi.mocked(projectHistory).mockResolvedValue({ ...report, activity: [] })
  rerender({ snapshot: { ...workspace, syncedAt: 'new-sync' } })
  await act(async () => {})
  await act(async () => finishOld(report))
  expect(saveCommitActivity).toHaveBeenCalledOnce()
  expect(saveCommitActivity).toHaveBeenLastCalledWith(expect.objectContaining({ repositories: { root: expect.objectContaining({ activity: [] }) } }))
})
