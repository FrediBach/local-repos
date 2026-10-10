// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PackageAudit, PackageUpdate, RepoProject, Workspace } from '../types'
import { defaultSettings } from '../lib/settings'
import { useWorkspaceActions } from './use-workspace-actions'

const api = vi.hoisted(() => ({ projectAction: vi.fn(), scanWithHelper: vi.fn(), api: vi.fn() }))
vi.mock('../lib/api', () => api)
vi.mock('./use-settings', () => ({ useSettings: () => ({ settings: defaultSettings }) }))

const finding = { name: 'unsafe-package', title: 'Unsafe dependency', range: '<1.0.1', url: 'https://example.test/advisory' }
const audit: PackageAudit = { manager: 'npm', scannedAt: '2026-10-10T12:00:00Z', counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }, findings: [{ ...finding, severity: 'high', direct: true, fixAvailable: true }] }
const clean: PackageAudit = { ...audit, scannedAt: '2026-10-10T13:00:00Z', counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, findings: [] }
const update: PackageUpdate = { level: 'patch', updatedAt: clean.scannedAt, packages: [{ name: finding.name, from: '1.0.0', to: '1.0.1' }], skipped: [] }
const root: RepoProject = { id: 'root', name: 'Root', dirName: 'root', relativePath: 'root', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: audit.scannedAt, audit, outdated: { manager: 'npm', scannedAt: audit.scannedAt, findings: [], score: 0, level: 'current' }, unused: { scannedAt: audit.scannedAt, knipVersion: '6.40.0', findings: [] }, storage: { totalBytes: 20, nodeModulesBytes: 10, hasNodeModules: true, partial: false, measuredAt: audit.scannedAt }, screenshot: 'data:image/png;base64,cached' }
const member: RepoProject = { ...root, id: 'member', name: 'Member', relativePath: 'root/packages/member', monorepo: { id: root.id, name: root.name, relativePath: root.relativePath, packagePath: 'packages/member', declaredWorkspace: true } }
const independent: RepoProject = { ...member, id: 'independent', monorepo: { ...member.monorepo!, declaredWorkspace: false } }
const workspace: Workspace = { rootName: 'Projects', rootPath: '/projects', projects: [root, member, independent], mode: 'helper', syncedAt: audit.scannedAt }

function options() {
  return { workspace, busy: '', workspaceVersion: { current: 0 }, setBusy: vi.fn(), setLogs: vi.fn(), setNotice: vi.fn(), setConnectOpen: vi.fn(), persist: vi.fn().mockResolvedValue(true), reportCriticalVulnerabilities: vi.fn() }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.projectAction.mockImplementation(async (_id: string, action: string) => action === 'audit' ? { audit: clean } : { packageUpdate: update })
  // Even a helper scan containing previous reports must not resurrect them.
  api.scanWithHelper.mockResolvedValue({ ...workspace, projects: workspace.projects.map(project => ({ ...project, screenshot: undefined, dependencies: [{ name: finding.name, version: '^1.0.1', kind: 'dependencies' }] })) })
})
afterEach(cleanup)

describe('compatible vulnerability fix workflow', () => {
  it('invalidates workspace reports, refreshes metadata, and saves only the fresh selected audit', async () => {
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(api.projectAction.mock.calls.map(call => call.slice(0, 3))).toEqual([[member.id, 'fix-vulnerability', finding], [member.id, 'audit', {}]])
    expect(api.scanWithHelper).toHaveBeenCalledWith('/projects', expect.any(Function))
    expect(props.persist).toHaveBeenCalledTimes(2)
    const invalidated = props.persist.mock.calls[0][0] as Workspace
    const saved = props.persist.mock.calls[1][0] as Workspace
    for (const project of invalidated.projects.slice(0, 2)) {
      expect(project.audit).toBeUndefined()
      expect(project.outdated).toBeUndefined()
      expect(project.unused).toBeUndefined()
      expect(project.storage).toBeUndefined()
      expect(project.screenshot).toBe(root.screenshot)
      expect(project.dependencies?.[0].version).toBe('^1.0.1')
    }
    expect(saved.projects.map(project => project.audit)).toEqual([undefined, clean, audit])
    expect(saved.projects[1].packageUpdate).toEqual(update)
    expect(saved.projects[2].outdated).toEqual(root.outdated)
    expect(props.reportCriticalVulnerabilities).toHaveBeenCalledExactlyOnceWith(member, clean)
    expect(props.setNotice).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining('Vulnerabilities were rescanned') }))
    expect(props.setBusy).toHaveBeenLastCalledWith('')
  })

  it('keeps reports cleared after an installation failure and does not run a follow-up audit', async () => {
    api.projectAction.mockRejectedValueOnce(new Error('No compatible fix is available.'))
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(api.projectAction).toHaveBeenCalledOnce()
    const saved = props.persist.mock.calls.at(-1)?.[0] as Workspace
    expect(saved.projects.map(project => project.audit)).toEqual([undefined, undefined, audit])
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: 'No compatible fix is available.', error: true })
  })

  it.each([new Error('Registry unavailable.'), undefined])('does not present a clean report if the follow-up audit fails or returns no report (%s)', async failure => {
    if (failure) api.projectAction.mockResolvedValueOnce({ packageUpdate: update }).mockRejectedValueOnce(failure)
    else api.projectAction.mockResolvedValueOnce({ packageUpdate: update }).mockResolvedValueOnce({})
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(props.persist).toHaveBeenCalledOnce()
    expect((props.persist.mock.calls[0][0] as Workspace).projects[1].audit).toBeUndefined()
    expect(props.reportCriticalVulnerabilities).not.toHaveBeenCalled()
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: expect.stringContaining('vulnerability recheck failed'), error: true })
  })

  it('persists cleared reports and warns when metadata refresh fails, without auditing stale metadata', async () => {
    api.scanWithHelper.mockRejectedValueOnce(new Error('Folder moved.'))
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(api.projectAction).toHaveBeenCalledOnce()
    const saved = props.persist.mock.calls[0][0] as Workspace
    expect(saved.projects.map(project => project.audit)).toEqual([undefined, undefined, audit])
    expect(saved.projects[1].packageUpdate).toEqual(update)
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: expect.stringContaining('Metadata could not be refreshed'), error: true })
  })

  it('keeps a cache failure visible after a successful re-audit', async () => {
    const props = options()
    props.persist.mockResolvedValue(false)
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect((props.persist.mock.calls.at(-1)?.[0] as Workspace).projects[1].audit).toEqual(clean)
    expect(props.setNotice).toHaveBeenLastCalledWith({ text: 'Results could not be saved in this browser.', error: true })
  })

  it.each(['fix', 'metadata', 'audit'] as const)('ignores late %s responses after the workspace generation changes', async phase => {
    const pending = deferred<unknown>()
    if (phase === 'fix') api.projectAction.mockReturnValueOnce(pending.promise)
    else if (phase === 'metadata') api.scanWithHelper.mockReturnValueOnce(pending.promise)
    else api.projectAction.mockResolvedValueOnce({ packageUpdate: update }).mockReturnValueOnce(pending.promise)
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let job!: Promise<void>
    await act(async () => { job = result.current.action(member, 'fix-vulnerability', finding) })
    props.workspaceVersion.current += 1
    const before = props.persist.mock.calls.length
    await act(async () => {
      pending.resolve(phase === 'fix' ? { packageUpdate: update } : phase === 'metadata' ? workspace : { audit: clean })
      await job
    })
    expect(props.persist).toHaveBeenCalledTimes(before)
    expect(props.setNotice).not.toHaveBeenCalled()
    expect(props.reportCriticalVulnerabilities).not.toHaveBeenCalled()
    expect(props.setBusy).toHaveBeenCalledExactlyOnceWith(`${member.id}:fix-vulnerability`)
  })

  it('requires a helper connection and respects the existing busy guard', async () => {
    const props = options()
    const { result, rerender } = renderHook(({ mode, busy }: { mode: Workspace['mode']; busy: string }) => useWorkspaceActions({ ...props, workspace: { ...workspace, mode }, busy }), { initialProps: { mode: 'browser' as Workspace['mode'], busy: '' } })
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(props.setConnectOpen).toHaveBeenCalledWith(true)
    rerender({ mode: 'helper', busy: 'batch-audit' })
    await act(async () => { await result.current.action(member, 'fix-vulnerability', finding) })
    expect(api.projectAction).not.toHaveBeenCalled()
    expect(props.persist).not.toHaveBeenCalled()
  })
})
