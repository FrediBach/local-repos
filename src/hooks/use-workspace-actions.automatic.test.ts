// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LighthouseReport, ReactDoctorReport, RepoProject, Workspace } from '@/types'
import { defaultSettings } from '@/lib/settings'
import { useWorkspaceActions } from './use-workspace-actions'

const api = vi.hoisted(() => ({ projectAction: vi.fn(), scanWithHelper: vi.fn(), api: vi.fn() }))
const filesystem = vi.hoisted(() => ({ canReadDirectory: vi.fn(), scanDirectory: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/filesystem', () => filesystem)
vi.mock('./use-settings', () => ({ useSettings: () => ({ settings }) }))

const reactDoctor: ReactDoctorReport = { scannedAt: '2026-10-10T10:00:00Z', version: '0.9.17', score: 92, label: 'Great', findings: [] }
const lighthouse: LighthouseReport = {
  scannedAt: reactDoctor.scannedAt, version: '12.8.2', url: 'http://localhost:3000/', requestedUrl: 'http://localhost:3000/', formFactor: 'mobile',
  categories: [{ id: 'performance', title: 'Performance', score: 82 }], audits: [], warnings: [],
}
const base: RepoProject = { id: 'react-library', name: 'React library', dirName: 'library', relativePath: 'library', description: '', stack: ['React'], scripts: {}, packageManager: 'npm', hasPackageJson: true, scannedAt: '' }
const projects: RepoProject[] = [
  base,
  { ...base, id: 'vue-app', name: 'Vue app', stack: ['Vue'], scripts: { dev: 'vite' } },
  { ...base, id: 'react-app', name: 'React app', scripts: { dev: 'vite' } },
  { ...base, id: 'backend', name: 'Backend', stack: ['Node.js'], scripts: { dev: 'node server.js' } },
]
const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', syncedAt: '', projects }
let settings = { ...defaultSettings, watcherAudit: false, watcherOutdated: false, watcherReactDoctor: true, watcherLighthouse: true }

function options(saved = workspace) {
  return { workspace: saved, busy: '', workspaceVersion: { current: 0 }, setBusy: vi.fn(), setLogs: vi.fn(), setNotice: vi.fn(), setConnectOpen: vi.fn(), persist: vi.fn().mockResolvedValue(true), reportCriticalVulnerabilities: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
  settings = { ...defaultSettings, watcherAudit: false, watcherOutdated: false, watcherReactDoctor: true, watcherLighthouse: true }
  api.scanWithHelper.mockResolvedValue(workspace)
  api.projectAction.mockImplementation(async (_id: string, action: string) => action === 'react-doctor' ? { reactDoctor } : { lighthouse })
})
afterEach(cleanup)

describe('automatic quality scans', () => {
  it.each([
    [true, true, [['react-library', 'react-doctor'], ['vue-app', 'lighthouse'], ['react-app', 'react-doctor'], ['react-app', 'lighthouse']]],
    [true, false, [['react-library', 'react-doctor'], ['react-app', 'react-doctor']]],
    [false, true, [['vue-app', 'lighthouse'], ['react-app', 'lighthouse']]],
    [false, false, []],
  ] as const)('runs only selected checks on eligible projects (React Doctor: %s, Lighthouse: %s)', async (watcherReactDoctor, watcherLighthouse, expected) => {
    settings = { ...settings, watcherReactDoctor, watcherLighthouse }
    const props = options()
    const progress = vi.fn()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let scanned: Workspace | undefined
    await act(async () => { scanned = await result.current.runAutomaticScan(undefined, () => true, progress) })
    expect(api.projectAction.mock.calls).toEqual(expected)
    expect(progress.mock.calls.map(([message]) => message)).toEqual(expected.map(([id, action]) => `Running ${action === 'react-doctor' ? 'React Doctor' : 'Lighthouse'} · ${projects.find(project => project.id === id)!.name}`))
    expect(scanned?.projects.map(project => [project.id, project.reactDoctor, project.lighthouse])).toEqual([
      ['react-library', watcherReactDoctor ? reactDoctor : undefined, undefined],
      ['vue-app', undefined, watcherLighthouse ? lighthouse : undefined],
      ['react-app', watcherReactDoctor ? reactDoctor : undefined, watcherLighthouse ? lighthouse : undefined],
      ['backend', undefined, undefined],
    ])
    if (expected.length) expect(props.persist).toHaveBeenLastCalledWith(scanned, false)
    else expect(props.persist).toHaveBeenCalledExactlyOnceWith(scanned, false, true)
    expect(props.setNotice).not.toHaveBeenCalled()
  })

  it('checks changed projects and newly discovered frontends while leaving unchanged projects alone', async () => {
    const discovered = { ...projects[2], id: 'new-app' }
    api.scanWithHelper.mockResolvedValue({ ...workspace, projects: [...projects, discovered] })
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.runAutomaticScan(['react-library'], () => true, vi.fn()) })
    expect(api.projectAction.mock.calls).toEqual([['react-library', 'react-doctor'], ['new-app', 'react-doctor'], ['new-app', 'lighthouse']])
  })

  it.each([
    ['react-doctor', 'failure', 'reactDoctor'],
    ['react-doctor', 'missing', 'reactDoctor'],
    ['lighthouse', 'failure', 'lighthouse'],
    ['lighthouse', 'missing', 'lighthouse'],
  ] as const)('preserves the dated %s report after a %s result and continues scanning', async (action, failure, key) => {
    const cachedDoctor = { ...reactDoctor, scannedAt: '2026-10-09T10:00:00Z' }
    const cachedLighthouse = { ...lighthouse, scannedAt: cachedDoctor.scannedAt }
    const saved = { ...workspace, projects: projects.map(project => ({ ...project, reactDoctor: cachedDoctor, lighthouse: cachedLighthouse })) }
    const failedId = action === 'react-doctor' ? 'react-library' : 'vue-app'
    api.projectAction.mockImplementation(async (id: string, name: string) => {
      if (id === failedId && name === action) {
        if (failure === 'failure') throw new Error('Analysis timed out.')
        return {}
      }
      return name === 'react-doctor' ? { reactDoctor } : { lighthouse }
    })
    const props = options(saved)
    const { result } = renderHook(() => useWorkspaceActions(props))
    let scanned: Workspace | undefined
    await act(async () => { scanned = await result.current.runAutomaticScan(undefined, () => true, vi.fn()) })
    expect(scanned?.projects.find(project => project.id === failedId)?.[key]).toBe(key === 'reactDoctor' ? cachedDoctor : cachedLighthouse)
    expect(scanned?.projects.find(project => project.id === 'react-app')).toMatchObject({ reactDoctor, lighthouse })
    expect(api.projectAction).toHaveBeenCalledTimes(4)
    expect(props.setNotice).toHaveBeenCalledWith({ text: expect.stringContaining(`(${action})`), error: true })
    expect(props.setNotice).toHaveBeenCalledWith({ text: expect.stringContaining(failure === 'failure' ? 'Analysis timed out.' : 'no report'), error: true })
    expect(props.persist).toHaveBeenLastCalledWith(scanned, false)
  })

  it('refreshes browser metadata without running either helper analysis or requesting a connection', async () => {
    const handle = { name: 'Projects' } as FileSystemDirectoryHandle
    const browser = { ...workspace, mode: 'browser' as const, handle }
    filesystem.canReadDirectory.mockResolvedValue(true)
    filesystem.scanDirectory.mockResolvedValue(workspace)
    const props = options(browser)
    const { result } = renderHook(() => useWorkspaceActions(props))
    await act(async () => { await result.current.runAutomaticScan(undefined, () => true, vi.fn()) })
    expect(filesystem.canReadDirectory).toHaveBeenCalledExactlyOnceWith(handle)
    expect(filesystem.scanDirectory).toHaveBeenCalledExactlyOnceWith(handle)
    expect(api.scanWithHelper).not.toHaveBeenCalled()
    expect(api.projectAction).not.toHaveBeenCalled()
    expect(props.setConnectOpen).not.toHaveBeenCalled()
    expect(props.persist).toHaveBeenCalledExactlyOnceWith(browser, false, true)
  })

  it.each([
    ['react-doctor', 'disabled'], ['lighthouse', 'disabled'],
    ['react-doctor', 'workspace changed'], ['lighthouse', 'workspace changed'],
  ] as const)('drops the late %s report and remaining checks when %s', async (action, reason) => {
    settings.watcherReactDoctor = action === 'react-doctor'
    let finish!: (report: Partial<RepoProject>) => void
    api.projectAction.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const props = options()
    const { result } = renderHook(() => useWorkspaceActions(props))
    let current = true
    let job!: Promise<Workspace | undefined>
    await act(async () => { job = result.current.runAutomaticScan(undefined, () => current, vi.fn()) })
    expect(api.projectAction).toHaveBeenCalledOnce()
    if (reason === 'disabled') current = false
    else props.workspaceVersion.current += 1
    await act(async () => { finish(action === 'react-doctor' ? { reactDoctor } : { lighthouse }); await job })
    expect(api.projectAction).toHaveBeenCalledOnce()
    expect(props.persist).toHaveBeenCalledExactlyOnceWith(workspace, false, true)
    expect(props.setNotice).not.toHaveBeenCalled()
    expect(await job).toBeUndefined()
    expect(props.setBusy.mock.calls).toEqual(reason === 'disabled' ? [['watcher'], ['']] : [['watcher']])
  })
})
