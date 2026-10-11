// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultSettings, SETTINGS_STORAGE_KEY } from './lib/settings'
import type { PackageAudit, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(),
  loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(),
}))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const cachedAudit: PackageAudit = {
  manager: 'npm', scannedAt: '2026-10-10T12:00:00Z',
  counts: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
  findings: [{ name: 'old-package', severity: 'high', title: 'Cached advisory' }],
}
const workspace: Workspace = {
  mode: 'helper', rootId: 'root_a', helperInstanceId: 'boot_a', revision: 1,
  rootName: 'Projects', rootPath: '/projects', syncedAt: '2026-10-10T12:00:00Z',
  projects: [{
    id: 'alpha', name: 'alpha', dirName: 'alpha', relativePath: 'alpha', description: '',
    stack: [], scripts: {}, packageManager: 'npm', hasPackageJson: true,
    packageFingerprint: 'original', scannedAt: '2026-10-10T12:00:00Z',
    git: { origin: 'https://github.com/example/alpha' }, audit: cachedAudit,
    remoteActivity: {
      repository: 'https://github.com/example/alpha', scannedAt: '2026-10-10T12:00:00Z',
      issues: [], pullRequests: [10],
    },
  }],
}
const response = (body: unknown) => ({ ok: true, json: async () => body })
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
let visible: boolean
let focused: boolean
let originalHead: string
let savedWorkspace: Workspace
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
  visible = false
  focused = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  originalHead = document.head.innerHTML
  document.head.innerHTML = '<title>Local Repos</title><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">'
  const settings = {
    ...defaultSettings, watcherMode: 'periodic', watcherIntervalMinutes: 1,
    watcherOutdated: false, watcherRemoteActivity: true, pushReminderEnabled: false,
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === SETTINGS_STORAGE_KEY ? JSON.stringify(settings) : null,
    setItem: vi.fn(),
  })
  savedWorkspace = workspace
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockImplementation(async (next: Workspace) => { savedWorkspace = next })
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/workspace-state') return response({ ...savedWorkspace, registered: true, resetRequired: false, activeOperations: [], warnings: [] })
    if (url === '/api/scan') return response({ ...savedWorkspace, syncedAt: new Date().toISOString() })
    if (url.endsWith('/audit')) return response({ audit: {
      ...cachedAudit, scannedAt: new Date().toISOString(),
      counts: { ...cachedAudit.counts, critical: 1 },
      findings: [...cachedAudit.findings, { name: 'unsafe-package', severity: 'critical', title: 'New critical advisory' }],
    } })
    if (url.endsWith('/remote-activity')) return response({ remoteActivity: {
      ...workspace.projects[0].remoteActivity, scannedAt: new Date().toISOString(), pullRequests: [11],
    } })
    return response({ ok: true, available: false })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  document.head.innerHTML = originalHead
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace favicon updates', () => {
  it('marks new watcher findings while away and clears unread state on return without dismissing critical alerts', async () => {
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')]
    const originalIcons = icons.map(icon => icon.outerHTML)
    const touchIcon = document.querySelector('link[rel="apple-touch-icon"]')!
    const originalTouchIcon = touchIcon.outerHTML
    await act(async () => { render(<App />) })

    expect(document.title).toBe('Local Repos')
    expect(icons.map(icon => icon.outerHTML)).toEqual(originalIcons)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await advance(60_000)

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/alpha/audit')).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/alpha/remote-activity')).toBe(true)
    expect(document.title).toContain('1 new vulnerability')
    expect(document.title).toContain('1 new pull/merge request')
    for (const icon of icons) expect(icon.getAttribute('href')).toMatch(/^data:image\/svg\+xml/)
    expect(touchIcon.outerHTML).toBe(originalTouchIcon)
    expect(screen.getByRole('alertdialog', { name: 'New critical vulnerabilities' })).toBeTruthy()

    await act(async () => {
      visible = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(document.title).toContain('1 new vulnerability')

    await act(async () => {
      focused = true
      window.dispatchEvent(new Event('focus'))
    })
    expect(document.title).toBe('Local Repos')
    expect(icons.map(icon => icon.outerHTML)).toEqual(originalIcons)
    expect(screen.getByRole('alertdialog', { name: 'New critical vulnerabilities' })).toBeTruthy()

    await act(async () => {
      focused = false
      visible = false
      window.dispatchEvent(new Event('blur'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(60_000)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects/alpha/audit')).toHaveLength(2)
    expect(document.title).toBe('Local Repos')
    expect(icons.map(icon => icon.outerHTML)).toEqual(originalIcons)
  })
})
