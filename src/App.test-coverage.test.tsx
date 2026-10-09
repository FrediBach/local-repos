// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { TestCoverageReport, RepoProject, Workspace } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(), loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn() }))
vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(), description: '',
  stack: name === 'Bravo' ? ['Vue'] : name === 'Charlie' ? ['Svelte'] : ['React'], scripts: name === 'Bravo' ? {} : { test: 'vitest run' }, dependencies: [], packageManager: 'npm', scannedAt: '2026-10-09T10:00:00Z',
}))
const workspace: Workspace = { rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, mode: 'helper', syncedAt: '2026-10-09T10:00:00Z' }
const metric = { total: 100, covered: 82, pct: 82 }
const report: TestCoverageReport = {
  scannedAt: '2026-10-09T12:00:00Z', runner: 'vitest', source: 'run', exitCode: 0,
  metrics: { lines: metric, statements: metric, functions: metric, branches: metric },
  files: [{ path: 'src/App.tsx', metrics: { lines: metric, statements: metric, functions: metric, branches: metric } }],
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
const requests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/test-coverage'))
const scanButton = () => screen.getByRole('button', { name: 'Scan test coverage', exact: true }) as HTMLButtonElement

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
    const id = /^\/api\/projects\/([^/]+)\/test-coverage$/.exec(url)?.[1]
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
async function complete(id: string, body: unknown = { testCoverage: report }, ok = true) {
  await act(async () => { pending[id].resolve(response(body, ok)); await pending[id].promise })
}

describe('Coverage actions', () => {
  it('scans supported test setups across frameworks despite filters and saves reports sequentially', async () => {
    const user = await renderConnected()
    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'No matching projects')
    expect(scanButton().disabled).toBe(false)
    await user.click(scanButton())
    expect(requests().map(([url]) => url)).toEqual(['/api/projects/alpha/test-coverage'])
    expect((screen.getByRole('button', { name: 'Scan vulnerabilities', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    await complete('alpha')
    await waitFor(() => expect(requests()).toHaveLength(2))
    expect(requests()[1][0]).toBe('/api/projects/charlie/test-coverage')
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], testCoverage: report }, projects[1], projects[2]] })
    await complete('charlie', { testCoverage: { ...report, source: 'existing-report' } })
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Coverage scan complete')).toBeTruthy()
  })

  it('retains the last report after failure and stops after the current project', async () => {
    savedWorkspace = { ...workspace, projects: [{ ...projects[0], testCoverage: report }, projects[1], projects[2]] }
    const user = await renderConnected()
    await user.click(scanButton())
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    await complete('alpha', { error: 'Coverage timed out.' }, false)
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(requests()).toHaveLength(1)
    expect(screen.getByText('Coverage timed out.')).toBeTruthy()
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Alpha:.*82.*coverage/i })).toBeTruthy()
  })

  it('runs a scan in the project tab, opens file insights from the badge, and hides the tab for projects without packages', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'View Alpha' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
    await user.click(dialog.getByRole('tab', { name: 'Coverage', exact: true }))
    await user.click(dialog.getByRole('button', { name: 'Run coverage scan' }))
    expect(requests()).toHaveLength(1)
    await complete('alpha')
    expect(await dialog.findByText('src/App.tsx')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...projects[0], testCoverage: report }, projects[1], projects[2]] })
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: /Alpha:.*82.*coverage/i }))
    expect(screen.getByRole('tab', { name: 'Coverage' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'View Bravo' }))
    expect(screen.queryByRole('tab', { name: 'Coverage' })).toBeNull()
  })

  it('clears completed coverage progress when forgetting the directory', async () => {
    savedWorkspace = { ...workspace, projects: [projects[0]] }
    const user = await renderConnected()
    await user.click(scanButton())
    await complete('alpha')
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(screen.getByRole('region', { name: 'Workspace coverage scan' })).toBeTruthy()
    expect(screen.getByText('Coverage scan complete')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Workspace info' }))
    await user.click(screen.getByRole('button', { name: 'Forget this directory' }))
    await screen.findByText('Directory disconnected. Your files are unchanged.')
    expect(storage.clearWorkspace).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Workspace coverage scan' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Alpha:.*coverage/i })).toBeNull()
  })

  it('offers the helper connection in browser mode and disables the global scan without supported test setups', async () => {
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
