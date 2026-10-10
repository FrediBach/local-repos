// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { AuditSeverity, PackageAudit, RepoProject, ScanResult, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(), loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(),
}))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

function project(id: string, name: string): RepoProject {
  return {
    id, name, dirName: id, relativePath: id, description: `The ${name} project.`,
    stack: ['React'], scripts: { dev: 'vite' }, packageManager: 'npm',
    scannedAt: '2026-10-07T10:00:00Z',
    dependencies: [{ name: 'react', version: '^19.0.0', kind: 'dependencies' }],
  }
}
const projects = [project('alpha', 'Alpha notebook'), project('bravo', 'Bravo site'), project('charlie', 'Charlie tools')]
const scan: ScanResult = {
  rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, syncedAt: '2026-10-07T10:00:00Z',
}
const workspace: Workspace = { ...scan, mode: 'helper' }

function audit(severity?: AuditSeverity): PackageAudit {
  return {
    manager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
    counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, ...(severity ? { [severity]: 1 } : {}) },
    findings: severity ? [{ name: 'react', severity, title: `Example ${severity} advisory`, direct: true }] : [],
  }
}
const reports = { alpha: audit('high'), bravo: audit(), charlie: audit('critical') }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>
let pending: Record<string, ReturnType<typeof deferred<Response>>>
let preview: ReturnType<typeof deferred<Response>>
let scannedWorkspace: ScanResult
const auditRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/audit'))
const scanButton = () => screen.getByRole('button', { name: 'Scan vulnerabilities', exact: true }) as HTMLButtonElement
const progress = () => screen.getByRole('progressbar', { name: 'Vulnerability scan progress' })
const progressSection = () => within(screen.getByRole('region', { name: 'Workspace vulnerability scan' }))
const badge = (name: string, severity: AuditSeverity) => screen.getByRole('button', {
  name: `${name}: 1 vulnerability, highest severity ${severity}. View audit details`,
})

beforeEach(() => {
  vi.resetAllMocks()
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  storage.saveFavorites.mockResolvedValue(undefined)
  storage.clearWorkspace.mockResolvedValue(undefined)
  scannedWorkspace = scan
  pending = Object.fromEntries(projects.map(item => [item.id, deferred<Response>()]))
  preview = deferred<Response>()
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return Promise.resolve(response({ ok: true }))
    if (url === '/api/scan') return Promise.resolve(response(scannedWorkspace))
    if (url === '/api/projects/alpha/screenshot') return preview.promise
    const id = /^\/api\/projects\/([^/]+)\/audit$/.exec(url)?.[1]
    if (id && pending[id]) return pending[id].promise
    throw new Error(`Unexpected API request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function loadProjects(next: RepoProject[]) {
  scannedWorkspace = { ...scan, projects: next }
  storage.loadWorkspace.mockResolvedValue({ ...scannedWorkspace, mode: 'helper' })
}
async function renderConnected() {
  const user = userEvent.setup()
  const result = render(<App />)
  await screen.findByRole('button', { name: 'View Alpha notebook' })
  storage.saveWorkspace.mockClear()
  return { user, ...result }
}
async function complete(id: keyof typeof reports, body: unknown = { audit: reports[id] }, ok = true) {
  await act(async () => { pending[id].resolve(response(body, ok)); await pending[id].promise })
}

describe('workspace vulnerability scans', () => {
  it('places the scan before preview capture and audits every project sequentially even when the list is filtered', async () => {
    const { user } = await renderConnected()
    const reactScan = screen.getByRole('button', { name: 'Scan React projects', exact: true })
    const lighthouseScan = screen.getByRole('button', { name: 'Scan frontends with Lighthouse', exact: true })
    expect(scanButton().nextElementSibling).toBe(reactScan)
    expect(reactScan.nextElementSibling).toBe(lighthouseScan)
    expect(lighthouseScan.nextElementSibling).toBe(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'Bravo site')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    const savedFirst = deferred<void>()
    storage.saveWorkspace.mockReturnValueOnce(savedFirst.promise)
    await user.click(scanButton())

    expect(auditRequests()).toEqual([['/api/projects/alpha/audit', expect.objectContaining({ method: 'POST', body: '{}' })]])
    expect(progress().getAttribute('aria-valuemax')).toBe('3')
    expect(progress().getAttribute('aria-valuenow')).toBe('0')
    expect(progress().getAttribute('aria-valuetext')).toContain('Alpha notebook')
    await complete('alpha')
    expect(auditRequests()).toHaveLength(1)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({
      ...workspace, projects: [{ ...projects[0], audit: reports.alpha }, projects[1], projects[2]],
    })
    await act(async () => { savedFirst.resolve(); await savedFirst.promise })
    await waitFor(() => expect(auditRequests()).toHaveLength(2))
    expect(auditRequests()[1][0]).toBe('/api/projects/bravo/audit')
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    expect(progress().getAttribute('aria-valuetext')).toContain('Bravo site')
    await complete('bravo')
    await waitFor(() => expect(auditRequests()).toHaveLength(3))
    expect(auditRequests()[2][0]).toBe('/api/projects/charlie/audit')
    await complete('charlie')

    const criticalAlert = screen.getByRole('alertdialog', { name: 'New critical vulnerabilities' })
    expect(within(criticalAlert).getByText('Charlie tools')).toBeTruthy()
    await user.click(within(criticalAlert).getByRole('button', { name: 'Dismiss alert' }))

    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(progress().getAttribute('aria-valuenow')).toBe('3')
    expect(progressSection().getByText('Vulnerability scan complete')).toBeTruthy()
    expect(progressSection().getByText('3 scanned')).toBeTruthy()
    expect(progressSection().getByText('2 vulnerable')).toBeTruthy()
    expect(progressSection().getByText('0 failed')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(3)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({
      ...workspace, projects: projects.map(item => ({ ...item, audit: reports[item.id as keyof typeof reports] })),
    })
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('continues after a failed audit, preserves its previous report, and recovers after a browser cache write fails', async () => {
    const previousReport = { ...audit('low'), scannedAt: '2026-10-06T12:00:00Z' }
    loadProjects([{ ...projects[0], audit: previousReport }, projects[1], projects[2]])
    const { user } = await renderConnected()
    storage.saveWorkspace.mockRejectedValueOnce(new Error('Quota exceeded'))
    await user.click(scanButton())
    await complete('alpha', { error: 'The package registry is unavailable.' }, false)
    await waitFor(() => expect(auditRequests()).toHaveLength(2))
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(badge('Alpha notebook', 'low')).toBeTruthy()
    await complete('bravo')
    await waitFor(() => expect(auditRequests()).toHaveLength(3))
    expect(progressSection().getByText(/could not be saved in browser storage/)).toBeTruthy()
    await complete('charlie')

    await user.click(screen.getByRole('button', { name: 'Dismiss alert' }))

    expect(progressSection().getByText('2 scanned')).toBeTruthy()
    expect(progressSection().getByText('1 vulnerable')).toBeTruthy()
    expect(progressSection().getByText('1 failed')).toBeTruthy()
    expect(progressSection().getByText(/The package registry is unavailable\./)).toBeTruthy()
    expect(progressSection().queryByText(/could not be saved in browser storage/)).toBeNull()
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(2)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({
      ...workspace, projects: [{ ...projects[0], audit: previousReport }, { ...projects[1], audit: reports.bravo }, { ...projects[2], audit: reports.charlie }],
    })
  })

  it('locks conflicting actions, stops after the current audit, and prevents scans during preview capture', async () => {
    const { user } = await renderConnected()
    await user.click(scanButton())
    expect(scanButton().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Capture previews', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Synced/ }) as HTMLButtonElement).disabled).toBe(true)
    for (const button of screen.getAllByRole('button', { name: 'Change directory', exact: true })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    await user.click(screen.getByRole('button', { name: 'View Bravo site' }))
    const dialog = screen.getByRole('dialog', { name: 'Bravo site' })
    for (const name of ['Start server', 'Capture preview', 'Measure disk usage', 'VS Code', 'Sourcetree']) {
      expect((within(dialog).getByRole('button', { name, exact: true }) as HTMLButtonElement).disabled).toBe(true)
    }
    await user.click(within(dialog).getByRole('tab', { name: 'Packages', exact: true }))
    expect((within(dialog).getByRole('button', { name: 'Scan for vulnerabilities' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await user.click(progressSection().getByRole('button', { name: 'Stop after current' }))
    expect((progressSection().getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true)
    await complete('alpha')

    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(auditRequests()).toHaveLength(1)
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    expect(progressSection().getByText('Vulnerability scan stopped')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenCalledOnce()
    expect(badge('Alpha notebook', 'high')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    expect(scanButton().disabled).toBe(true)
    await user.click(scanButton())
    expect(auditRequests()).toHaveLength(1)
  })

  it('shows saved severity badges in grid and list, opens the audit details, and removes a badge after a clean rescan', async () => {
    loadProjects([{ ...projects[0], audit: reports.alpha }, { ...projects[1], audit: reports.bravo }, projects[2]])
    const { user } = await renderConnected()
    expect(badge('Alpha notebook', 'high').classList.contains('audit-severity-high')).toBe(true)
    expect(screen.getAllByRole('button', { name: /View audit details/ })).toHaveLength(1)
    await user.click(badge('Alpha notebook', 'high'))
    let dialog = screen.getByRole('dialog', { name: 'Alpha notebook' })
    expect(within(dialog).getByText('Example high advisory')).toBeTruthy()
    expect(within(dialog).getByRole('columnheader', { name: 'Declared version' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(badge('Alpha notebook', 'high').closest('.projects-list')).toBeTruthy()
    await user.click(badge('Alpha notebook', 'high'))
    dialog = screen.getByRole('dialog', { name: 'Alpha notebook' })
    expect(within(dialog).getByText('Example high advisory')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))

    await user.click(scanButton())
    await user.click(progressSection().getByRole('button', { name: 'Stop after current' }))
    await complete('alpha', { audit: audit() })
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(screen.queryByRole('button', { name: /View audit details/ })).toBeNull()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: [{ ...projects[0], audit: audit() }, { ...projects[1], audit: reports.bravo }, projects[2]],
    }))
  })

  it('audits cached projects without an unsolicited startup rescan', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha notebook' })
    await user.click(scanButton())
    await complete('alpha')
    await waitFor(() => expect(auditRequests()).toHaveLength(2))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/scan')).toBe(false)
    expect(badge('Alpha notebook', 'high')).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenCalledOnce()
    await user.click(progressSection().getByRole('button', { name: 'Stop after current' }))
    await complete('bravo')
    expect(auditRequests()).toHaveLength(2)
  })

  it('opens the helper connection for browser-only workspaces without making audit requests', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser' })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha notebook' })
    await user.click(scanButton())
    expect(screen.getByRole('dialog', { name: 'Bring your projects together.' })).toBeTruthy()
    expect(auditRequests()).toHaveLength(0)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })

  it.each(['demo', 'empty'] as const)('disables global scanning for the %s workspace', async mode => {
    if (mode === 'demo') storage.loadWorkspace.mockResolvedValue(undefined)
    else loadProjects([])
    const user = userEvent.setup()
    render(<App />)
    if (mode === 'demo') await screen.findByText('You’re looking at an example workspace.')
    else await screen.findByText('No repositories or package.json files were found in this directory.')
    expect(scanButton().disabled).toBe(true)
    await user.click(scanButton())
    expect(auditRequests()).toHaveLength(0)
  })
})
