// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { LighthouseReport, RepoProject, Workspace } from '../types'
import { defaultSettings } from '../lib/settings'
import { useWorkspaceActions } from './use-workspace-actions'

const api = vi.hoisted(() => ({ projectAction: vi.fn(), scanWithHelper: vi.fn(), api: vi.fn() }))
vi.mock('../lib/api', () => api)
vi.mock('./use-settings', () => ({ useSettings: () => ({ settings: defaultSettings }) }))

const report: LighthouseReport = {
  scannedAt: '2026-10-09T12:00:00Z', version: '12.8.2', url: 'http://localhost:3000/', requestedUrl: 'http://localhost:3000/', formFactor: 'mobile',
  categories: [{ id: 'performance', title: 'Performance', score: 82 }, { id: 'accessibility', title: 'Accessibility', score: 100 }, { id: 'best-practices', title: 'Best practices', score: 100 }, { id: 'seo', title: 'SEO', score: 100 }],
  audits: [], warnings: [],
}
const frontend: RepoProject = {
  id: 'frontend', name: 'Frontend', dirName: 'frontend', relativePath: 'frontend', description: '',
  stack: ['React'], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: report.scannedAt, lighthouse: report,
}
const workspace: Workspace = { rootName: 'Projects', rootPath: '/projects', projects: [frontend, { ...frontend, id: 'second' }], mode: 'helper', syncedAt: report.scannedAt }

function options() {
  return { workspace, busy: '', workspaceVersion: { current: 0 }, setBusy: vi.fn(), setLogs: vi.fn(), setNotice: vi.fn(), setConnectOpen: vi.fn(), persist: vi.fn().mockResolvedValue(true), reportCriticalVulnerabilities: vi.fn() }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

describe('Lighthouse workspace coordination', () => {
  it('blocks other batches, project actions, and watcher scans immediately while Lighthouse is active', async () => {
    const pending = deferred<{ lighthouse: LighthouseReport }>()
    api.projectAction.mockReturnValue(pending.promise)
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let job!: Promise<void>
    await act(async () => {
      job = result.current.scanAllLighthouse()
      await result.current.scanAllVulnerabilities()
      await result.current.scanAllOutdated()
      await result.current.scanAllReactDoctor()
      await result.current.captureAllPreviews()
      await result.current.action(frontend, 'start')
      await result.current.runAutomaticScan(undefined, () => true, vi.fn())
    })
    expect(api.projectAction).toHaveBeenCalledExactlyOnceWith('frontend', 'lighthouse')
    expect(api.scanWithHelper).not.toHaveBeenCalled()
    expect(result.current.packageBusy(frontend)).toBe('frontend:lighthouse')
    act(() => { result.current.lighthouseBatch.stop() })
    await act(async () => { pending.resolve({ lighthouse: report }); await job })
    expect(props.persist).toHaveBeenCalledExactlyOnceWith(workspace, false)
  })

  it('ignores a late report and cancels queued scans after the workspace changes', async () => {
    const pending = deferred<{ lighthouse: LighthouseReport }>()
    api.projectAction.mockReturnValue(pending.promise)
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let job!: Promise<void>
    act(() => { job = result.current.scanAllLighthouse() })
    props.workspaceVersion.current += 1
    await act(async () => { pending.resolve({ lighthouse: report }); await job })
    expect(api.projectAction).toHaveBeenCalledOnce()
    expect(props.persist).not.toHaveBeenCalled()
    expect(props.setBusy).toHaveBeenCalledExactlyOnceWith('batch-lighthouse')
  })

  it('ignores a late individual report without clearing the current workspace busy state', async () => {
    const pending = deferred<{ lighthouse: LighthouseReport }>()
    api.projectAction.mockReturnValue(pending.promise)
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let job!: Promise<void>
    act(() => { job = result.current.action(frontend, 'lighthouse') })
    props.workspaceVersion.current += 1
    await act(async () => { pending.resolve({ lighthouse: report }); await job })
    expect(props.persist).not.toHaveBeenCalled()
    expect(props.setNotice).not.toHaveBeenCalled()
    expect(props.setBusy).toHaveBeenCalledExactlyOnceWith('frontend:lighthouse')
  })

  it('preserves the previous report when an individual scan fails or returns no report', async () => {
    api.projectAction.mockRejectedValueOnce(new Error('Lighthouse timed out.')).mockResolvedValueOnce({})
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(frontend, 'lighthouse') })
    expect(props.setNotice).toHaveBeenCalledWith({ text: 'Lighthouse timed out.', error: true })
    await act(async () => { await result.current.action(frontend, 'lighthouse') })
    expect(props.setNotice).toHaveBeenCalledWith({ text: 'The helper did not return a Lighthouse report.', error: true })
    expect(props.persist).not.toHaveBeenCalled()
    expect(props.workspace.projects[0].lighthouse).toBe(report)
  })

  it('rejects unsupported projects and requires the helper for eligible frontends', async () => {
    const props = options()
    const { result, rerender } = renderHook((workspace: Workspace) => useWorkspaceActions({ ...props, workspace }), { initialProps: workspace })
    await act(async () => { await result.current.action({ ...frontend, scripts: {} }, 'lighthouse') })
    expect(api.projectAction).not.toHaveBeenCalled()
    rerender({ ...workspace, mode: 'browser' })
    await act(async () => { await result.current.action(frontend, 'lighthouse') })
    expect(props.setConnectOpen).toHaveBeenCalledWith(true)
    expect(api.projectAction).not.toHaveBeenCalled()
  })

  it.each([true, false])('invalidates reports only in the affected package workspace after an update (success: %s)', async success => {
    const member = { ...frontend, id: 'member', monorepo: { id: 'frontend', name: 'Frontend', relativePath: 'frontend', packagePath: 'packages/member', declaredWorkspace: true } }
    const independent = { ...frontend, id: 'independent', monorepo: { ...member.monorepo, declaredWorkspace: false } }
    const props = { ...options(), workspace: { ...workspace, projects: [frontend, member, independent] } }
    if (success) api.projectAction.mockResolvedValue({ packageUpdate: { level: 'patch', updatedAt: report.scannedAt, packages: [], skipped: [] } })
    else api.projectAction.mockRejectedValue(new Error('Install failed.'))
    api.scanWithHelper.mockResolvedValue({ ...props.workspace, projects: props.workspace.projects.map(({ lighthouse: _lighthouse, ...project }) => project) })
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'update-patches') })
    const saved = props.persist.mock.calls.at(-1)?.[0] as Workspace
    expect(saved.projects.map(project => [project.id, project.lighthouse])).toEqual([['frontend', undefined], ['member', undefined], ['independent', report]])
  })
})
