// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { ReactDoctorReport, RepoProject, Workspace } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(), loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(), description: '',
  stack: name === 'Bravo' ? ['Vue'] : ['React'], scripts: {}, dependencies: [], packageManager: 'npm', scannedAt: '2026-10-09T10:00:00Z',
}))
const workspace: Workspace = { rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, mode: 'helper', syncedAt: '2026-10-09T10:00:00Z' }
const report: ReactDoctorReport = {
  scannedAt: '2026-10-09T12:00:00Z', version: '0.9.17', score: 82, label: 'Great',
  findings: [{ filePath: 'src/App.tsx', line: 12, column: 4, rule: 'no-derived-state', plugin: 'react-doctor', severity: 'warning', message: 'Compute derived state during render', help: 'Remove the effect and compute the value directly.', category: 'State & Effects' }],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
let fetchMock: ReturnType<typeof vi.fn>
let pending: Record<string, ReturnType<typeof deferred<Response>>>
let savedWorkspace: Workspace
const requests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/react-doctor'))
const scanButton = () => screen.getByRole('button', { name: 'Scan React projects', exact: true }) as HTMLButtonElement

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  savedWorkspace = workspace
  storage.loadWorkspace.mockImplementation(async () => savedWorkspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  pending = Object.fromEntries(projects.map(item => [item.id, deferred<Response>()]))
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return Promise.resolve(response({ ok: true }))
    if (url === '/api/scan') { const { mode: _mode, ...scan } = savedWorkspace; return Promise.resolve(response(scan)) }
    const id = /^\/api\/projects\/([^/]+)\/react-doctor$/.exec(url)?.[1]
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
  storage.saveWorkspace.mockClear()
  return user
}
async function complete(id: string, body: unknown = { reactDoctor: report }, ok = true) {
  await act(async () => { pending[id].resolve(response(body, ok)); await pending[id].promise })
}

describe('React Doctor actions', () => {
  it('scans every React project despite filters, skips other frameworks, and saves reports sequentially', async () => {
    const user = await renderConnected()
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'Bravo')
    await user.click(scanButton())
    expect(requests().map(([url]) => url)).toEqual(['/api/projects/alpha/react-doctor'])
    expect((screen.getByRole('button', { name: 'Scan vulnerabilities', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    await complete('alpha')
    await waitFor(() => expect(requests()).toHaveLength(2))
    expect(requests()[1][0]).toBe('/api/projects/charlie/react-doctor')
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], reactDoctor: report }, projects[1], projects[2]] })
    await complete('charlie', { reactDoctor: { ...report, score: 100, findings: [] } })
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(2)
    expect(screen.getByText('React Doctor scan complete')).toBeTruthy()
  })

  it('retains the last report after failure and stops after the current project', async () => {
    savedWorkspace = { ...workspace, projects: [{ ...projects[0], reactDoctor: report }, projects[1], projects[2]] }
    const user = await renderConnected()
    await user.click(scanButton())
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    await complete('alpha', { error: 'React Doctor timed out.' }, false)
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(requests()).toHaveLength(1)
    expect(screen.getByText('React Doctor timed out.')).toBeTruthy()
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Alpha:.*82.*React Doctor/i })).toBeTruthy()
  })

  it('runs a scan in the project tab, opens findings from the score badge, and hides the tab for non-React projects', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'View Alpha' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
    await user.click(dialog.getByRole('tab', { name: 'React Doctor', exact: true }))
    await user.click(dialog.getByRole('button', { name: 'Run React Doctor' }))
    expect(requests()).toHaveLength(1)
    await complete('alpha')
    expect(await dialog.findByText('Compute derived state during render')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], reactDoctor: report }, projects[1], projects[2]] })
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: /Alpha:.*82.*React Doctor/i }))
    expect(screen.getByRole('tab', { name: 'React Doctor' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'View Bravo' }))
    expect(screen.queryByRole('tab', { name: 'React Doctor' })).toBeNull()
  })

  it('offers the helper connection in browser mode and disables the global scan without React projects', async () => {
    savedWorkspace = { ...workspace, mode: 'browser' }
    const user = await renderConnected()
    await user.click(scanButton())
    expect(screen.getByRole('dialog', { name: 'Bring your projects together.' })).toBeTruthy()
    expect(requests()).toHaveLength(0)
    cleanup()
    savedWorkspace = { ...workspace, projects: [projects[1]] }
    render(<App />)
    await screen.findByRole('button', { name: 'View Bravo' })
    expect(scanButton().disabled).toBe(true)
  })
})
