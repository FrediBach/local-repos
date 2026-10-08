// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultSettings } from './lib/settings'
import type { Workspace } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), clearWorkspace: vi.fn() }))
const filesystem = vi.hoisted(() => ({ canReadDirectory: vi.fn(), scanDirectory: vi.fn(), chooseDirectory: vi.fn() }))
vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => filesystem)
const workspace: Workspace = {
  mode: 'helper', rootName: 'Projects', rootPath: '/projects', syncedAt: '2026-10-08T12:00:00Z',
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
  settings = { ...defaultSettings, watcherMode: 'periodic', watcherIntervalMinutes: 1 }
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings), setItem: vi.fn() })
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  fetch = vi.fn(async (url: string) => response(url === '/api/scan' ? workspace : url.endsWith('/audit') ? { audit } : url.endsWith('/outdated') ? { outdated } : { ok: true }))
  vi.stubGlobal('fetch', fetch)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function setup() { await act(async () => { render(<App />) }) }

describe('automatic workspace scans', () => {
  it('refreshes metadata and selected reports sequentially, and saves results', async () => {
    await setup()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/health'])
    await advance(60_000)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit', '/api/projects/alpha/outdated', '/api/projects/bravo/audit', '/api/projects/bravo/outdated'])
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
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'local-repos:settings:v1' })) })
    await act(async () => { finish(response({ audit })) })
    await advance(120_000)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit'])
    expect(screen.getByRole('region', { name: 'Workspace watcher' }).textContent).toBe('Manual scans only')
    expect((screen.getByRole('button', { name: 'Scan vulnerabilities', exact: true }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('honors selected checks and skips package checks for projects without package.json', async () => {
    settings = { ...settings, watcherOutdated: false, watcherStorage: true }
    const scanned = { ...workspace, projects: [workspace.projects[0], { ...workspace.projects[1], hasPackageJson: false }] }
    const measurement = { totalBytes: 1, nodeModulesBytes: 0, hasNodeModules: false, measuredAt: '', partial: false }
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string) => url === '/api/scan' ? Promise.resolve(response(scanned)) : url.endsWith('/storage') ? Promise.resolve(response({ storage: measurement })) : original(url))
    await setup()
    await advance(60_000)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/health', '/api/scan', '/api/projects/alpha/audit', '/api/projects/alpha/storage', '/api/projects/bravo/storage'])
  })

  it('does not prompt for expired browser permissions or perform helper checks', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser', handle: { name: 'Projects' } })
    filesystem.canReadDirectory.mockResolvedValue(false)
    await setup()
    await advance(60_000)
    expect(filesystem.canReadDirectory).toHaveBeenCalledExactlyOnceWith({ name: 'Projects' })
    expect(filesystem.scanDirectory).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/health'])
    expect(screen.getByRole('region', { name: 'Workspace watcher' }).textContent).toContain('folder permission expired')
  })
})
