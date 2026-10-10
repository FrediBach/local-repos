// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { SETTINGS_STORAGE_KEY } from './lib/settings'
import type { AuditSeverity, PackageAudit, PackageOutdated, ReactDoctorReport, RepoProject, ScanResult, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(),
  loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(),
}))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
vi.mock('./lib/filesystem', () => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), canReadDirectory: vi.fn() }))

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(), description: '',
  stack: ['React'], scripts: {}, dependencies: [{ name: 'react', version: '19.0.0', kind: 'dependencies' }],
  packageManager: 'npm', scannedAt: '2026-10-09T10:00:00Z',
}))
const workspace: Workspace = {
  rootName: 'Projects', rootPath: '/Users/ada/Projects', projects, mode: 'helper', syncedAt: '2026-10-09T10:00:00Z',
}

function audit(severity?: AuditSeverity, title = 'Unsafe dependency advisory'): PackageAudit {
  return {
    manager: 'npm', scannedAt: '2026-10-09T12:00:00Z',
    counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, ...(severity ? { [severity]: 1 } : {}) },
    findings: severity ? [{ name: 'react', severity, title, direct: true }] : [],
  }
}
function outdated(level: 'high' | 'moderate' | 'current' = 'high'): PackageOutdated {
  return {
    manager: 'npm', scannedAt: '2026-10-09T12:00:00Z', level,
    score: level === 'high' ? 100 : level === 'moderate' ? 10 : 0,
    findings: level === 'current' ? [] : [{
      name: 'old-library', current: '1.0.0', latest: level === 'high' ? '11.0.0' : '2.0.0',
      change: 'major', majorGap: level === 'high' ? 10 : 1, score: level === 'high' ? 100 : 10,
    }],
  }
}
function doctor(severity?: 'error' | 'warning'): ReactDoctorReport {
  return {
    scannedAt: '2026-10-09T12:00:00Z', version: '0.9.17', score: severity ? 72 : 100, label: severity ? 'Good' : 'Great',
    findings: severity ? [{
      filePath: 'src/App.tsx', line: 12, column: 4, rule: 'no-derived-state', plugin: 'react-doctor', severity,
      message: 'Compute derived state during render', help: 'Remove the effect.', category: 'State & Effects',
    }] : [],
  }
}

const auditTitle = 'Fix high-severity vulnerabilities'
const outdatedTitle = 'Update outdated dependencies'
const doctorTitle = 'Fix React Doctor errors'
const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response)
const todosNav = () => screen.getByRole('button', { name: 'Todos', exact: true })
const todoBadge = (name: string, count: number) => screen.getByRole('button', {
  name: `${name}: ${count} ${count === 1 ? 'todo' : 'todos'}. View todos`,
})
const review = (title: string, name = 'Alpha') => screen.getByRole('button', { name: `Review ${title} in ${name}` })
const dismiss = (title: string, name = 'Alpha') => screen.getByRole('button', { name: `Dismiss ${title} in ${name}` })

let savedWorkspace: Workspace
let scannedWorkspace: ScanResult
let actionResponses: Record<string, { body: unknown; ok?: boolean }>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  const preferences = new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ pushReminderEnabled: false })]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => { preferences.set(key, value) },
    removeItem: (key: string) => { preferences.delete(key) },
  })
  savedWorkspace = workspace
  scannedWorkspace = workspace
  actionResponses = {}
  storage.loadWorkspace.mockImplementation(async () => savedWorkspace)
  storage.saveWorkspace.mockImplementation(async (next: Workspace) => { savedWorkspace = next })
  storage.loadFavorites.mockResolvedValue([])
  storage.saveFavorites.mockResolvedValue(undefined)
  storage.clearWorkspace.mockResolvedValue(undefined)
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return response({ ok: true })
    if (url === '/api/scan') return response(scannedWorkspace)
    const result = actionResponses[url]
    if (result) return response(result.body, result.ok)
    throw new Error(`Unexpected API request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function loadProjects(next: RepoProject[]) {
  savedWorkspace = { ...workspace, projects: next }
  scannedWorkspace = savedWorkspace
}
function loadImportantProjects() {
  loadProjects([
    { ...projects[0], audit: audit('high'), outdated: outdated(), reactDoctor: doctor('error') },
    { ...projects[1], audit: audit('high') },
    { ...projects[2], audit: audit('moderate'), outdated: outdated('moderate'), reactDoctor: doctor('warning'),
      unused: { scannedAt: '2026-10-09T12:00:00Z', knipVersion: '6.40.0', findings: [{ name: 'unused-library', version: '1.0.0', kind: 'dependencies' }] } },
  ])
}
async function renderConnected() {
  const user = userEvent.setup()
  const result = render(<App />)
  await screen.findByRole('button', { name: 'View Alpha' })
  storage.saveWorkspace.mockClear()
  return { user, ...result }
}
async function openProject(user: ReturnType<typeof userEvent.setup>, tab = 'Vulnerabilities') {
  await user.click(screen.getByRole('button', { name: 'View Alpha' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
  await user.click(dialog.getByRole('tab', { name: tab, exact: true }))
  return dialog
}

describe('automatic workspace todos', () => {
  it('places Todos below Daily summary and counts only important grouped tasks in grid and list', async () => {
    loadImportantProjects()
    const { user } = await renderConnected()
    expect(screen.getByRole('button', { name: 'Daily summary' }).nextElementSibling).toBe(todosNav())
    expect(within(todosNav()).getByText('4')).toBeTruthy()
    expect(todoBadge('Alpha', 3).textContent).toContain('3')
    expect(todoBadge('Bravo', 1).textContent).toContain('1')
    expect(screen.getAllByRole('button', { name: /\. View todos$/ })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(todoBadge('Alpha', 3).closest('.projects-list')).toBeTruthy()
    expect(todoBadge('Bravo', 1).closest('.projects-list')).toBeTruthy()
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'Charlie')
    await user.click(todosNav())
    expect(screen.getByRole('heading', { level: 1, name: 'Todos' })).toBeTruthy()
    expect(todosNav().getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('combobox', { name: 'Search projects' })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(within(screen.getByRole('article', { name: 'Alpha todos' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('article', { name: 'Bravo todos' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Charlie todos' })).toBeNull()
  })

  it('opens a project badge as a filtered list and reviews the relevant project reports', async () => {
    loadImportantProjects()
    const { user } = await renderConnected()
    await user.click(todoBadge('Alpha', 3))
    expect(screen.getByRole('article', { name: 'Alpha todos' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Bravo todos' })).toBeNull()
    for (const [title, tab, reportText] of [
      [auditTitle, 'Vulnerabilities', 'Unsafe dependency advisory'],
      [outdatedTitle, 'Updates', '11.0.0'],
      [doctorTitle, 'React Doctor', 'Compute derived state during render'],
    ]) {
      await user.click(review(title))
      const dialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
      expect(dialog.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected')).toBe('true')
      expect(dialog.getByText(reportText)).toBeTruthy()
      await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    }
    await user.click(screen.getByRole('button', { name: 'All todos', exact: true }))
    expect(screen.getByRole('article', { name: 'Bravo todos' })).toBeTruthy()
  })

  it('persists dismissals across reloads and unchanged rescans, and resurfaces new findings', async () => {
    loadProjects([{ ...projects[0], audit: audit('high') }])
    const { user, unmount } = await renderConnected()
    await user.click(todosNav())
    await user.click(dismiss(auditTitle))
    expect(screen.queryByRole('listitem')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^All projects/ }))
    expect(screen.queryByRole('button', { name: /\. View todos$/ })).toBeNull()

    unmount()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha' })
    expect(screen.queryByRole('button', { name: /\. View todos$/ })).toBeNull()
    let dialog = await openProject(user)
    actionResponses['/api/projects/alpha/audit'] = { body: { audit: { ...audit('high'), scannedAt: '2026-10-09T13:00:00Z' } } }
    await user.click(dialog.getByRole('button', { name: 'Scan again', exact: true }))
    await waitFor(() => expect(storage.saveWorkspace).toHaveBeenCalledOnce())
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('button', { name: /\. View todos$/ })).toBeNull()

    actionResponses['/api/projects/alpha/audit'] = { body: { audit: audit('high', 'A newly discovered advisory') } }
    dialog = await openProject(user)
    await user.click(dialog.getByRole('button', { name: 'Scan again', exact: true }))
    await dialog.findByText('A newly discovered advisory')
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    expect(todoBadge('Alpha', 1)).toBeTruthy()
    await user.click(todosNav())
    expect(review(auditTitle)).toBeTruthy()
  })

  it('adds and removes tasks after batch scans while retaining findings across metadata refreshes and failures', async () => {
    loadProjects([{ ...projects[0], audit: audit('high') }, projects[1]])
    actionResponses['/api/projects/alpha/audit'] = { body: { audit: audit() } }
    actionResponses['/api/projects/bravo/audit'] = { body: { audit: audit('high') } }
    const { user } = await renderConnected()
    const scanButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Scan vulnerabilities', exact: true })
    await user.click(scanButton())
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(screen.queryByRole('button', { name: 'Alpha: 1 todo. View todos' })).toBeNull()
    expect(todoBadge('Bravo', 1)).toBeTruthy()

    scannedWorkspace = { ...workspace, projects: [projects[0], projects[1]] }
    await user.click(screen.getByRole('button', { name: /^Synced/ }))
    await screen.findByText('Up to date. 2 projects synced.')
    expect(todoBadge('Bravo', 1)).toBeTruthy()
    actionResponses['/api/projects/bravo/audit'] = { body: { error: 'Registry unavailable.' }, ok: false }
    await user.click(scanButton())
    await screen.findByText(/Registry unavailable\./)
    expect(todoBadge('Bravo', 1)).toBeTruthy()

    actionResponses['/api/projects/bravo/audit'] = { body: { audit: audit() } }
    await user.click(scanButton())
    await waitFor(() => expect(scanButton().disabled).toBe(false))
    expect(screen.queryByRole('button', { name: /\. View todos$/ })).toBeNull()
    await user.click(todosNav())
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByRole('heading', { name: 'No important active todos.' })).toBeTruthy()
  })

  it.each([
    { action: 'outdated', tab: 'Updates', first: 'Scan for outdated packages', again: 'Scan outdated again', key: 'outdated', report: outdated(), clean: outdated('current'), title: outdatedTitle },
    { action: 'react-doctor', tab: 'React Doctor', first: 'Run React Doctor', again: 'Scan React again', key: 'reactDoctor', report: doctor('error'), clean: doctor(), title: doctorTitle },
  ])('updates todos after individual $action scans', async ({ action, tab, first, again, key, report, clean, title }) => {
    loadProjects([projects[0]])
    actionResponses[`/api/projects/alpha/${action}`] = { body: { [key]: report } }
    const { user } = await renderConnected()
    const dialog = await openProject(user, tab)
    await user.click(dialog.getByRole('button', { name: first, exact: true }))
    await dialog.findByRole('button', { name: again, exact: true })
    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))
    await user.click(todoBadge('Alpha', 1))
    await user.click(review(title))

    actionResponses[`/api/projects/alpha/${action}`] = { body: { [key]: clean } }
    const reportDialog = within(screen.getByRole('dialog', { name: 'Alpha' }))
    await user.click(reportDialog.getByRole('button', { name: again, exact: true }))
    await waitFor(() => expect(storage.saveWorkspace).toHaveBeenCalledTimes(2))
    await user.click(reportDialog.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByRole('heading', { name: 'No important active todos.' })).toBeTruthy()
  })
})
