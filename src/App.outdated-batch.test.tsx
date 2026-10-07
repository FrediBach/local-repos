// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { PackageOutdated, RepoProject, Workspace } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(), loadFavorites: vi.fn(), saveFavorites: vi.fn() }))
vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(), description: '',
  stack: [], scripts: {}, dependencies: [], packageManager: 'npm', scannedAt: '2026-10-07T10:00:00Z',
}))
const workspace: Workspace = { rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, mode: 'helper', syncedAt: '2026-10-07T10:00:00Z' }
const report: PackageOutdated = {
  manager: 'npm', scannedAt: '2026-10-07T12:00:00Z', score: 10, level: 'moderate',
  findings: [{ name: 'react', current: '18.3.0', latest: '19.0.0', change: 'major', majorGap: 1, score: 10 }],
}
const clean: PackageOutdated = { ...report, score: 0, level: 'current', findings: [] }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
let fetchMock: ReturnType<typeof vi.fn>
let pending: Record<string, ReturnType<typeof deferred<Response>>>
let savedWorkspace: Workspace
const requests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/outdated'))
const scanButton = () => screen.getByRole('button', { name: 'Scan outdated packages', exact: true }) as HTMLButtonElement
const section = () => within(screen.getByRole('region', { name: 'Workspace outdated-package scan' }))

beforeEach(() => {
  vi.resetAllMocks()
  savedWorkspace = workspace
  storage.loadWorkspace.mockImplementation(async () => savedWorkspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  pending = Object.fromEntries(projects.map(item => [item.id, deferred<Response>()]))
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return Promise.resolve(response({ ok: true }))
    if (url === '/api/scan') { const { mode: _mode, ...scan } = savedWorkspace; return Promise.resolve(response(scan)) }
    const id = /^\/api\/projects\/([^/]+)\/outdated$/.exec(url)?.[1]
    if (id && pending[id]) return pending[id].promise
    throw new Error(`Unexpected API request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function renderConnected() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'View Alpha' })
  await waitFor(() => expect(storage.saveWorkspace).toHaveBeenCalledWith(savedWorkspace))
  storage.saveWorkspace.mockClear()
  return user
}
async function complete(id: string, body: unknown = { outdated: report }, ok = true) {
  await act(async () => { pending[id].resolve(response(body, ok)); await pending[id].promise })
}

describe('outdated-package actions', () => {
  it('scans the entire workspace sequentially, persists each result, and sums scores despite filtering', async () => {
    const user = await renderConnected()
    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'Bravo')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    await user.click(scanButton())
    expect(requests().map(([url]) => url)).toEqual(['/api/projects/alpha/outdated'])
    expect((screen.getByRole('button', { name: 'Scan vulnerabilities', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    await complete('alpha')
    await waitFor(() => expect(requests()).toHaveLength(2))
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], outdated: report }, projects[1], projects[2]] })
    await complete('bravo', { outdated: clean })
    await waitFor(() => expect(requests()).toHaveLength(3))
    await complete('charlie', { outdated: { ...report, score: 0.3, level: 'low', findings: [{ name: 'tiny', current: '1.0.0', latest: '1.0.3', change: 'patch', majorGap: 0, score: 0.3 }] } })
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(section().getByText('3 scanned')).toBeTruthy()
    expect(section().getByText('2 with outdated packages')).toBeTruthy()
    expect(section().getByText('10.3 total lag points')).toBeTruthy()
    expect(section().getByText('Outdated-package scan complete')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(3)
  })

  it('preserves previous reports after failures, keeps scanning, and stops after the current project', async () => {
    savedWorkspace = { ...workspace, projects: [{ ...projects[0], outdated: report }, projects[1], projects[2]] }
    const user = await renderConnected()
    await user.click(scanButton())
    await complete('alpha', { error: 'Registry unavailable.' }, false)
    await waitFor(() => expect(requests()).toHaveLength(2))
    storage.saveWorkspace.mockRejectedValueOnce(new Error('Quota exceeded'))
    await user.click(section().getByRole('button', { name: 'Stop after current' }))
    await complete('bravo', { outdated: { ...clean, skipped: [{ name: 'local', reason: 'Workspace dependency' }] } })
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(requests()).toHaveLength(2)
    expect(section().getByText('Outdated-package scan stopped')).toBeTruthy()
    expect(section().getByText('1 failed')).toBeTruthy()
    expect(section().getByText('Registry unavailable.')).toBeTruthy()
    expect(section().getByText(/1 package was skipped/)).toBeTruthy()
    expect(section().getByText(/could not be saved in browser storage/)).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ projects: [expect.objectContaining({ outdated: report }), expect.objectContaining({ outdated: expect.objectContaining({ score: 0 }) }), projects[2]] }))
  })

  it('runs a single-project scan from Packages and exposes the saved result through its card badge', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'View Alpha' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
    await user.click(dialog.getByRole('button', { name: 'Packages', exact: true }))
    await user.click(dialog.getByRole('button', { name: 'Scan for outdated packages' }))
    expect(requests()).toHaveLength(1)
    await complete('alpha')
    expect(await dialog.findByText('19.0.0')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], outdated: report }, projects[1], projects[2]] })
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    const badge = screen.getByRole('button', { name: /Alpha:.*View outdated/ })
    await user.click(badge)
    expect(within(screen.getByRole('dialog', { name: 'Alpha' })).getByText('19.0.0')).toBeTruthy()
  })

  it('offers a helper connection for browser-only workspaces', async () => {
    savedWorkspace = { ...workspace, mode: 'browser' }
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha' })
    await user.click(scanButton())
    expect(screen.getByRole('dialog', { name: 'Bring your projects together.' })).toBeTruthy()
    expect(requests()).toHaveLength(0)
  })
})
