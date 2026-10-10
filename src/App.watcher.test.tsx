// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultSettings, SETTINGS_STORAGE_KEY } from './lib/settings'
import type { Workspace } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(), clearWorkspace: vi.fn() }))
const filesystem = vi.hoisted(() => ({ canReadDirectory: vi.fn(), scanDirectory: vi.fn(), chooseDirectory: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
vi.mock('./lib/filesystem', () => filesystem)
const workspace: Workspace = {
  mode: 'helper', rootId: 'root_a', helperInstanceId: 'boot_a', revision: 1, rootName: 'Projects', rootPath: '/projects', syncedAt: '2026-10-08T12:00:00Z',
  projects: ['alpha', 'bravo'].map(id => ({ id, name: id, dirName: id, relativePath: id, description: '', stack: [], scripts: {}, packageManager: 'npm', hasPackageJson: true, packageFingerprint: 'original', scannedAt: '' })),
}
const audit = { manager: 'npm', scannedAt: '', counts: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 }, findings: [] }
const outdated = { manager: 'npm', scannedAt: '', findings: [], score: 0, level: 'current' }
const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
let fetch: ReturnType<typeof vi.fn>
let settings = { ...defaultSettings, watcherMode: 'periodic' as 'periodic' | 'manual', watcherIntervalMinutes: 1 }
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks()
  vi.setSystemTime(new Date(2026, 9, 9, 12))
  settings = { ...defaultSettings, watcherMode: 'periodic', watcherIntervalMinutes: 1 }
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings), setItem: vi.fn() })
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  fetch = vi.fn(async (url: string) => response(url === '/api/workspace-state' ? { ...workspace, registered: true, resetRequired: false, activeOperations: [], warnings: [] } : url === '/api/scan' ? workspace : url.endsWith('/audit') ? { audit } : url.endsWith('/outdated') ? { outdated } : { ok: true }))
  vi.stubGlobal('fetch', fetch)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function setup() { await act(async () => { render(<App />) }) }

describe('automatic workspace scans', () => {
  it('alerts immediately for new critical findings, groups projects, and does not repeat identical results', async () => {
    const critical = { ...audit, counts: { ...audit.counts, high: 0, critical: 1 }, findings: [{ name: 'unsafe-package', severity: 'critical', title: 'Example critical advisory' }] }
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url.endsWith('/audit') ? Promise.resolve(response({ audit: critical })) : original(url))
    await setup()
    await advance(60_000)
    const alert = screen.getByRole('alertdialog', { name: 'New critical vulnerabilities' })
    expect(within(alert).getByRole('region', { name: 'Critical findings in alpha' })).toBeTruthy()
    expect(within(alert).getByRole('region', { name: 'Critical findings in bravo' })).toBeTruthy()
    expect(within(alert).getAllByText('unsafe-package')).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/outdated'))).toHaveLength(2)
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss alert' }))
    await advance(60_000)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/audit'))).toHaveLength(4)
  })

  it('alerts on a new critical advisory at the same count, but not on loading cached findings', async () => {
    const critical = { ...audit, counts: { ...audit.counts, high: 0, critical: 1 }, findings: [{ name: 'unsafe-package', severity: 'critical', title: 'Old advisory' }] }
    storage.loadWorkspace.mockResolvedValue({ ...workspace, projects: workspace.projects.map(project => ({ ...project, audit: critical })) })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url.endsWith('/audit') ? Promise.resolve(response({ audit: { ...critical, findings: [{ ...critical.findings[0], title: 'New advisory' }] } })) : original(url))
    await setup()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await advance(60_000)
    const alert = screen.getByRole('alertdialog')
    expect(within(alert).getAllByText('New advisory')).toHaveLength(2)
    expect(within(alert).queryByText('Old advisory')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Review audit for alpha' }))
    await advance(0)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const details = screen.getByRole('dialog', { name: 'alpha' })
    expect(within(details).getByRole('tab', { name: 'Vulnerabilities' }).getAttribute('aria-selected')).toBe('true')
    expect(within(details).getByText('New advisory')).toBeTruthy()
  })

  it('keeps critical alerts visible despite cache failures and suppresses repeats for the session', async () => {
    const critical = { ...audit, counts: { ...audit.counts, critical: 1 }, findings: [] }
    storage.saveWorkspace.mockRejectedValue(new Error('Quota exceeded'))
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url.endsWith('/audit') ? Promise.resolve(response({ audit: critical })) : original(url))
    await setup()
    await advance(60_000)
    const alert = screen.getByRole('alertdialog')
    expect(within(alert).getAllByText(/1 additional critical issue/)).toHaveLength(2)
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss alert' }))
    await advance(60_000)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('refreshes metadata and selected reports sequentially, and saves results', async () => {
    await setup()
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health'])
    await advance(60_000)
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit', '/api/projects/alpha/outdated', '/api/projects/bravo/audit', '/api/projects/bravo/outdated'])
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: workspace.projects.map(project => ({ ...project, audit, outdated })) })
    expect(screen.getByRole('region', { name: 'Workspace watcher' }).textContent).toContain('Last automatic scan')
  })

  it('continues after one failed check and preserves the previous report', async () => {
    const cached = { ...workspace, projects: [{ ...workspace.projects[0], audit }, workspace.projects[1]] }
    storage.loadWorkspace.mockResolvedValue(cached)
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url === '/api/projects/alpha/audit' ? Promise.resolve(response({ error: 'Registry unavailable' }, false)) : original(url))
    await setup()
    await advance(60_000)
    expect(screen.getByRole('alert').textContent).toContain('Registry unavailable')
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: workspace.projects.map(project => ({ ...project, audit, outdated })) })
  })

  it('stops the remaining queue when manual mode is selected during an audit', async () => {
    let finish!: (value: ReturnType<typeof response>) => void
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url === '/api/projects/alpha/audit' ? new Promise(resolve => { finish = resolve }) : original(url))
    await setup()
    await advance(60_000)
    settings.watcherMode = 'manual'
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY })) })
    await act(async () => { finish(response({ audit })) })
    await advance(120_000)
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit'])
    expect(screen.getByRole('region', { name: 'Workspace watcher' }).textContent).toBe('Manual scans only')
    expect((screen.getByRole('button', { name: 'Run checks', exact: true }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('honors selected checks and skips package checks for projects without package.json', async () => {
    settings = { ...settings, watcherOutdated: false, watcherStorage: true }
    const scanned = { ...workspace, projects: [workspace.projects[0], { ...workspace.projects[1], hasPackageJson: false }] }
    const measurement = { totalBytes: 1, nodeModulesBytes: 0, hasNodeModules: false, measuredAt: '', partial: false }
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url === '/api/scan' ? Promise.resolve(response(scanned)) : url.endsWith('/storage') ? Promise.resolve(response({ storage: measurement })) : original(url))
    await setup()
    await advance(60_000)
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit', '/api/projects/alpha/storage', '/api/projects/bravo/storage'])
  })

  it('defers automatic scans and disables batch starts while another client is working', async () => {
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url === '/api/workspace-state' ? Promise.resolve(response({ ...workspace, registered: true, activeOperations: [{ operationId: 'op_external', kind: 'audit', projectIds: ['alpha'], progress: { phase: 'Checking advisories' } }] })) : original(url))
    await setup()
    await advance(3000)
    await advance(57_000)
    expect(screen.getByText('Helper work: Checking advisories')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run checks', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health'])
    fetch.mockImplementation(original)
    await act(async () => window.dispatchEvent(new Event('focus')))
    await advance(5000)
    expect(fetch.mock.calls.some(([url]) => url === '/api/scan')).toBe(true)
  })

  it('does not prompt for expired browser permissions or perform helper checks', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser', handle: { name: 'Projects' } })
    filesystem.canReadDirectory.mockResolvedValue(false)
    await setup()
    await advance(60_000)
    expect(filesystem.canReadDirectory).toHaveBeenCalledExactlyOnceWith({ name: 'Projects' })
    expect(filesystem.scanDirectory).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url !== '/api/workspace-state')).toEqual(['/api/health'])
    expect(screen.getByRole('region', { name: 'Workspace watcher' }).textContent).toContain('folder permission expired')
  })
})
