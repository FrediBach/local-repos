// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { PackageAudit, PackageUnused, ProjectStorage, RepoProject, ScanResult, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(), loadFavorites: vi.fn(), saveFavorites: vi.fn(),
}))
vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const project: RepoProject = {
  id: 'alpha', name: 'Notebook', dirName: 'notebook', relativePath: 'group/notebook',
  description: 'Keep your notes together.', stack: [], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '2026-10-07T10:00:00Z',
  dependencies: [
    { name: '@acme/widgets', version: 'workspace:^', kind: 'dependencies' },
    { name: 'react', version: '^19.0.0', kind: 'dependencies' },
  ],
}
const projects: RepoProject[] = [
  project,
  { ...project, id: 'bravo', name: 'react-handbook', dirName: 'react-handbook', relativePath: 'react-handbook', description: 'A collection of development notes.', dependencies: [] },
  { ...project, id: 'charlie', name: 'Weather', dirName: 'weather', relativePath: 'weather', dependencies: [{ name: 'react', version: '^18.3.1', kind: 'dependencies' }] },
]
const scan: ScanResult = { rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, syncedAt: '2026-10-07T10:00:00Z' }
const workspace: Workspace = { ...scan, mode: 'helper' }
const measured: ProjectStorage = { totalBytes: 2 * 1024 ** 3, nodeModulesBytes: 500 * 1024 ** 2, hasNodeModules: true, partial: false, measuredAt: '2026-10-07T12:00:00Z' }
const afterDelete: ProjectStorage = { ...measured, totalBytes: measured.totalBytes - measured.nodeModulesBytes, nodeModulesBytes: 0, hasNodeModules: false }
const report: PackageAudit = {
  manager: 'npm', scannedAt: '2026-10-07T12:00:00Z', counts: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
  findings: [{ name: 'react', severity: 'high', title: 'Example advisory', range: '<19.0.1', direct: true, fixAvailable: true, url: 'https://example.test/advisory' }],
}

const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response)
let fetchMock: ReturnType<typeof vi.fn>
let auditError: string | undefined
const actionRequests = (action: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/${action}`))

beforeEach(() => {
  vi.resetAllMocks()
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  storage.saveFavorites.mockResolvedValue(undefined)
  auditError = undefined
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return response({ ok: true })
    if (url === '/api/scan') return response(scan)
    if (url === '/api/projects/alpha/storage') return response({ storage: measured })
    if (url === '/api/projects/alpha/delete-node-modules') return response({ storage: afterDelete })
    if (url === '/api/projects/alpha/audit') return auditError ? response({ error: auditError }, false) : response({ audit: report })
    throw new Error(`Unexpected API request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderConnected() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'View Notebook' })
  storage.saveWorkspace.mockClear()
  return user
}

async function openProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'View Notebook' }))
  return screen.getByRole('dialog', { name: 'Notebook' })
}

describe('workspace package search', () => {
  it('runs Knip on demand, saves findings across resync, and keeps them when a rescan fails', async () => {
    const unused: PackageUnused = { scannedAt: '2026-10-08T12:00:00Z', knipVersion: '6.40.0', findings: [{ name: 'unused-package', version: '^1.0.0', kind: 'devDependencies', line: 12 }] }
    const user = await renderConnected()
    const original = fetchMock.getMockImplementation()!
    let failure = false
    fetchMock.mockImplementation((url: string) => url.endsWith('/unused') ? failure ? response({ error: 'Knip configuration failed' }, false) : response({ unused }) : original(url))
    const details = await openProject(user)
    await user.click(within(details).getByRole('tab', { name: 'Packages' }))
    expect(actionRequests('unused')).toHaveLength(0)
    await user.click(within(details).getByRole('button', { name: 'Scan for unused packages' }))
    await within(details).findByText('unused-package')
    expect(actionRequests('unused')).toHaveLength(1)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ projects: expect.arrayContaining([expect.objectContaining({ id: 'alpha', unused })]) }))
    failure = true
    await user.click(within(details).getByRole('button', { name: 'Scan unused again' }))
    await screen.findByText('Knip configuration failed')
    expect(within(details).getByText('unused-package')).toBeTruthy()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Synced/ }))
    await waitFor(() => expect(actionRequests('scan')).toHaveLength(1))
    const reopened = await openProject(user)
    await user.click(within(reopened).getByRole('tab', { name: 'Packages' }))
    expect(within(reopened).getByText('unused-package')).toBeTruthy()
  })

  it('opens a critical alert for a manual project audit and suppresses an unchanged rescan', async () => {
    const user = await renderConnected()
    const critical = { ...report, counts: { ...report.counts, high: 0, critical: 1 }, findings: [{ ...report.findings[0], severity: 'critical' }] }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string) => url.endsWith('/audit') ? response({ audit: critical }) : original(url))
    const details = await openProject(user)
    await user.click(within(details).getByRole('tab', { name: 'Packages' }))
    await user.click(within(details).getByRole('button', { name: 'Scan for vulnerabilities' }))
    const alert = await screen.findByRole('alertdialog', { name: 'New critical vulnerabilities' })
    expect(within(alert).getByText('Example advisory')).toBeTruthy()
    await user.click(within(alert).getByRole('button', { name: 'Dismiss alert' }))
    await user.click(within(details).getByRole('button', { name: 'Scan again' }))
    expect(actionRequests('audit')).toHaveLength(2)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('includes declared package names in general search and displays the declared version in grid and list results', async () => {
    const user = await renderConnected()
    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), '@ACME/WIDGETS')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    const card = screen.getByRole('article')
    expect(within(card).getByRole('button', { name: 'View Notebook' })).toBeTruthy()
    expect(within(card).getByText('@acme/widgets')).toBeTruthy()
    expect(within(card).getByText('workspace:^')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(within(screen.getByRole('article')).getByText('workspace:^')).toBeTruthy()
    const dialog = await openProject(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Packages', exact: true }))
    expect(within(dialog).getByRole('columnheader', { name: 'Declared version' })).toBeTruthy()
    expect(within(dialog).getByText('workspace:^')).toBeTruthy()
    expect(within(dialog).getByText(/Versions are declared ranges from package.json/)).toBeTruthy()
  })

  it('limits package-only search to projects declaring matching dependencies', async () => {
    const user = await renderConnected()
    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'ReAcT')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'View react-handbook' })).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'View react-handbook' })).toBeNull()
    expect(screen.getByText('^19.0.0')).toBeTruthy()
    expect(screen.getByText('^18.3.1')).toBeTruthy()
    expect(screen.getByText(/2 of 3 projects · matching declared packages/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('searches compatible version ranges in both search scopes and views', async () => {
    const versionProjects: RepoProject[] = ['^16.2.1', '>=15', '^15.0.0', '^17.0.0'].map((version, index) => ({
      ...project, id: `next-${index}`, name: `Next project ${index}`, dependencies: [{ name: 'next', version, kind: 'dependencies' }],
    }))
    const versionScan = { ...scan, projects: versionProjects }
    storage.loadWorkspace.mockResolvedValue({ ...versionScan, mode: 'helper' })
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/health') return response({ ok: true })
      if (url === '/api/scan') return response(versionScan)
      throw new Error(`Unexpected API request: ${url}`)
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Next project 0' })
    const search = screen.getByRole('textbox', { name: 'Search projects' })
    await user.type(search, 'next@16.*.*')
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('^16.2.1')).toBeTruthy()
    expect(screen.getByText('>=15')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View Next project 2' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View Next project 3' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('^16.2.1')).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'next@16.0.0')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View Next project 1' })).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'next@invalid')
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('article')).toHaveLength(4)
  })
})

describe('workspace maintenance actions', () => {
  it('requests disk measurement, updates the selected project, and persists the returned sizes without changing other projects', async () => {
    const user = await renderConnected()
    const dialog = await openProject(user)
    expect(actionRequests('storage')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Measure disk usage' }))
    await within(dialog).findByText('2.0 GiB')
    expect(within(dialog).getByText('500.0 MiB')).toBeTruthy()
    expect(actionRequests('storage')).toEqual([['/api/projects/alpha/storage', expect.objectContaining({ method: 'POST', body: '{}', headers: expect.objectContaining({ 'X-Local-Repos': '1' }) })]])
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...project, storage: measured }, projects[1], projects[2]] })
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.getByText('2.0 GiB on disk · 500.0 MiB node_modules')).toBeTruthy()
  })

  it('requires confirmation before sending delete-node-modules and persists the fresh measurement afterward', async () => {
    const user = await renderConnected()
    const dialog = await openProject(user)
    await user.click(within(dialog).getByRole('button', { name: 'Measure disk usage' }))
    await within(dialog).findByText('2.0 GiB')
    await user.click(within(dialog).getByRole('button', { name: 'Delete node_modules' }))
    let confirmation = screen.getByRole('dialog', { name: 'Delete node_modules?' })
    expect(within(confirmation).getByText('group/notebook/node_modules')).toBeTruthy()
    expect(actionRequests('delete-node-modules')).toHaveLength(0)
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(actionRequests('delete-node-modules')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Delete node_modules' }))
    confirmation = screen.getByRole('dialog', { name: 'Delete node_modules?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Delete node_modules' }))
    await within(dialog).findByText('No root node_modules directory found.')
    expect(actionRequests('delete-node-modules')).toEqual([['/api/projects/alpha/delete-node-modules', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true }) })]])
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...project, storage: afterDelete }, projects[1], projects[2]] })
    expect((within(dialog).getByRole('button', { name: 'Delete node_modules' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('updates and persists an audit report and retains it if a later scan fails', async () => {
    const user = await renderConnected()
    const dialog = await openProject(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Packages', exact: true }))
    expect(within(dialog).getByText('Not scanned yet.')).toBeTruthy()
    expect(actionRequests('audit')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Scan for vulnerabilities' }))
    await within(dialog).findByText('Example advisory')
    expect(within(dialog).getByRole('status').textContent).toContain('1 reported vulnerability')
    expect(actionRequests('audit')).toEqual([['/api/projects/alpha/audit', expect.objectContaining({ method: 'POST', body: '{}' })]])
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...project, audit: report }, projects[1], projects[2]] })
    storage.saveWorkspace.mockClear()
    auditError = 'The package registry is unavailable.'
    await user.click(within(dialog).getByRole('button', { name: 'Scan again' }))
    await screen.findByText('The package registry is unavailable.')
    expect(within(dialog).getByRole('status').textContent).toContain('1 reported vulnerability')
    expect(within(dialog).getByText('Example advisory')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Scan again' }) as HTMLButtonElement).disabled).toBe(false)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(actionRequests('audit')).toHaveLength(2)
  })
})
