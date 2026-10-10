// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { PackageAudit, RepoProject, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), clearWorkspace: vi.fn(),
  loadFavorites: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: vi.fn(), saveProjectTags: vi.fn(),
}))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))

const alpha: RepoProject = {
  id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'apps/alpha',
  description: 'A React dashboard', stack: ['React', 'TypeScript'], packageManager: 'npm',
  scripts: { dev: 'vite', build: 'vite build', 'test:watch': 'vitest' },
  dependencies: [{ name: 'react', version: '^19.0.0', kind: 'dependencies' }],
  scannedAt: '2026-10-08T10:00:00Z',
}
const beta: RepoProject = {
  ...alpha, id: 'beta', name: 'Beta', dirName: 'beta', relativePath: 'tools/beta',
  description: 'A utility library', stack: [], scripts: { test: 'vitest run' }, dependencies: [],
}
const workspace: Workspace = {
  rootName: 'Projects', rootPath: '/projects', mode: 'helper', projects: [alpha, beta], syncedAt: alpha.scannedAt,
}
const audit: PackageAudit = {
  manager: 'npm', scannedAt: '2026-10-09T10:00:00Z',
  counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, findings: [],
}
const response = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response)
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.loadProjectTags.mockResolvedValue({ beta: ['work'] })
  storage.saveWorkspace.mockResolvedValue(undefined)
  storage.saveProjectTags.mockResolvedValue(undefined)
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return response({ ok: true })
    if (url === '/api/projects/alpha/open' || url === '/api/projects/alpha/run-script') return response({ ok: true })
    if (url === '/api/projects/alpha/audit') return response({ audit })
    throw new Error(`Unexpected API request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function setup() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'View Alpha' })
  await waitFor(() => expect(storage.loadProjectTags).toHaveBeenCalledOnce())
  storage.saveWorkspace.mockClear()
  return { user, search: screen.getByRole('combobox', { name: 'Search projects' }) }
}

function suggestion(title: string) {
  const list = screen.getByRole('listbox', { name: 'Search suggestions' })
  const option = within(list).getByText(title, { exact: true }).closest('[role="option"]')
  if (!(option instanceof HTMLElement)) throw new Error(`Missing option for ${title}`)
  return option
}

describe('smart project search', () => {
  it('discovers actions without a query and opens the selected project folder through the helper', async () => {
    const { user, search } = await setup()
    await user.click(search)
    expect(search.getAttribute('aria-expanded')).toBe('true')
    expect(suggestion('Alpha')).toBeTruthy()
    expect(suggestion('Run a script')).toBeTruthy()
    expect(suggestion('Add or edit tags')).toBeTruthy()
    await user.click(suggestion('Open project folder'))
    await user.click(suggestion('Alpha'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/open', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ app: 'folder' }), headers: expect.objectContaining({ 'X-Local-Repos': '1' }),
    })))
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox', { name: 'Search suggestions' })).toBeNull()
  })

  it('autocompletes a project script and sends its displayed name and command', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'local-repos:settings:v2' ? JSON.stringify({ terminal: 'iterm2' }) : null, setItem: vi.fn(), removeItem: vi.fn() })
    const { user, search } = await setup()
    await user.click(search)
    await user.click(suggestion('Alpha'))
    await user.type(search, 'build')
    expect(suggestion('Run build').textContent).toContain('vite build')
    await user.click(suggestion('Run build'))
    await screen.findByText('Script sent to your terminal. Follow its progress and stop it there.')
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/run-script', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'build', command: 'vite build', terminal: 'iterm2' }),
    }))
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })

  it('matches an action and project together without requiring a remembered command syntax', async () => {
    const { user, search } = await setup()
    await user.type(search, 'build alpha')
    const run = suggestion('Run build')
    expect(run.textContent).toContain('Alpha')
    await user.click(run)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/run-script', expect.objectContaining({
      body: JSON.stringify({ name: 'build', command: 'vite build', terminal: 'auto' }),
    })))
  })

  it('reruns the selected project vulnerability check and persists the returned report', async () => {
    const oldAudit = { ...audit, scannedAt: alpha.scannedAt }
    storage.loadWorkspace.mockResolvedValue({ ...workspace, projects: [{ ...alpha, audit: oldAudit }, beta] })
    const { user, search } = await setup()
    await user.click(search)
    await user.click(suggestion('Alpha'))
    await user.click(suggestion('Scan for vulnerabilities'))
    await screen.findByText('Package audit completed for Alpha.')
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/audit', expect.objectContaining({ method: 'POST', body: '{}' }))
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith({ ...workspace, projects: [{ ...alpha, audit }, beta] })
  })

  it('opens the existing tag editor with suggestions, saves tags, and restores search focus', async () => {
    const { user, search } = await setup()
    await user.click(search)
    await user.click(suggestion('Alpha'))
    await user.click(suggestion('Add or edit tags'))
    const dialog = screen.getByRole('dialog', { name: 'Tags for Alpha' })
    await user.click(within(dialog).getByRole('button', { name: 'work', exact: true }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Add a tag' }), 'side project')
    await user.click(within(dialog).getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(storage.saveProjectTags).toHaveBeenLastCalledWith({ alpha: ['side project', 'work'], beta: ['work'] }))
    expect(document.activeElement).toBe(search)
    expect(screen.getByRole('button', { name: 'Filter by tag: side project' })).toBeTruthy()
  })

  it('offers the local helper connection instead of launching browser-directory scripts or applications', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser', rootPath: undefined })
    const { user, search } = await setup()
    await user.click(search)
    await user.click(suggestion('Alpha'))
    expect(suggestion('Open project folder').textContent).toContain('Connect the local helper')
    expect(suggestion('Run build').textContent).toContain('Connect the local helper')
    expect(suggestion('Add or edit tags').getAttribute('aria-disabled')).not.toBe('true')
    for (const title of ['Open project folder', 'Run build']) {
      await user.click(suggestion(title))
      const connection = screen.getByRole('dialog', { name: 'Bring your projects together.' })
      await user.click(within(connection).getByRole('button', { name: 'Close dialog' }))
      await user.click(search)
      await user.click(suggestion('Alpha'))
    }
    // Scheduled local Git reads are independent of these UI interactions.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/projects/') && !String(url).endsWith('/push-status'))).toHaveLength(0)
  })

  it('supports keyboard browsing, completion, backtracking, and dismissal without launching on Tab', async () => {
    const { user, search } = await setup()
    await user.click(search)
    const alphaOption = suggestion('Alpha')
    expect(search.getAttribute('aria-activedescendant')).toBe(alphaOption.id)
    await user.keyboard('{ArrowDown}')
    expect(search.getAttribute('aria-activedescendant')).not.toBe(alphaOption.id)
    await user.keyboard('{ArrowUp}')
    await user.type(search, 'Alpha{Tab}')
    expect(suggestion('Run build')).toBeTruthy()
    expect(document.activeElement).toBe(search)
    await user.keyboard('{Backspace}')
    expect(suggestion('Open project folder')).toBeTruthy()
    expect(suggestion('Alpha')).toBeTruthy()
    await user.type(search, 'Alpha{Enter}build{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Search suggestions' })).toBeNull()
    expect((search as HTMLInputElement).value).toBe('build')
    await user.keyboard('{ArrowDown}{Tab}')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/run-script'))).toBe(false)
    await user.click(search)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/run-script', expect.objectContaining({
      body: JSON.stringify({ name: 'build', command: 'vite build', terminal: 'auto' }),
    })))
  })

  it('opens workspace settings from an autocompleted command', async () => {
    const { user, search } = await setup()
    await user.type(search, 'settings')
    await user.click(suggestion('Open settings'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByRole('tab', { name: 'Applications' })).toBeTruthy()
    await user.click(within(settings).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('resets the selected project scope when navigation returns to all projects', async () => {
    const { user, search } = await setup()
    await user.type(search, 'Alpha{Tab}')
    expect(suggestion('Run build')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^All projects/ }))
    expect(screen.queryByRole('button', { name: 'Back to all commands' })).toBeNull()
    const resetSearch = screen.getByRole('combobox', { name: 'Search projects' })
    expect((resetSearch as HTMLInputElement).value).toBe('')
    await user.click(resetSearch)
    expect(suggestion('Alpha')).toBeTruthy()
    expect(suggestion('Beta')).toBeTruthy()
    expect(suggestion('Run a script')).toBeTruthy()
  })

  it('opens project details when a log command returns output and restores search focus', async () => {
    const originalFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string) => url.endsWith('/logs') ? response({ logs: 'VITE ready on http://localhost:5173' }) : originalFetch(url))
    const { user, search } = await setup()
    await user.type(search, 'logs alpha')
    await user.click(suggestion('View server logs'))
    const details = screen.getByRole('dialog', { name: 'Alpha' })
    expect(within(details).getByRole('tab', { name: 'Development' }).getAttribute('aria-selected')).toBe('true')
    await within(details).findByText('VITE ready on http://localhost:5173')
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/alpha/logs', expect.objectContaining({ method: 'GET' }))
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(search)
  })

  it.each([
    ['Review package updates', 'updates alpha', 'Updates', 'Scan for outdated packages'],
    ['Review dependency cleanup', 'cleanup alpha', 'Overview', 'Measure disk usage'],
  ])('opens %s in its matching tab without starting a mutation', async (title, query, tab, control) => {
    const { user, search } = await setup()
    await user.type(search, query)
    await user.click(suggestion(title))
    const details = within(screen.getByRole('dialog', { name: 'Alpha' }))
    expect(details.getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true')
    expect(details.getByRole('button', { name: control })).toBeTruthy()
    // Scheduled local Git reads are independent of these UI interactions.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/projects/') && !String(url).endsWith('/push-status'))).toHaveLength(0)
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(search)
  })

  it('prevents another helper action while a command is still running', async () => {
    let finishAudit!: (result: Response) => void
    const originalFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string) => url.endsWith('/audit')
      ? new Promise<Response>(resolve => { finishAudit = resolve })
      : originalFetch(url))
    const { user, search } = await setup()
    await user.click(search)
    await user.click(suggestion('Alpha'))
    await user.click(suggestion('Scan for vulnerabilities'))
    await user.click(search)
    await user.click(suggestion('Alpha'))
    const folder = suggestion('Open project folder')
    expect(folder.getAttribute('aria-disabled')).toBe('true')
    await user.click(folder)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/open'))).toBe(false)
    await act(async () => finishAudit(await response({ audit })))
    await screen.findByText('Package audit completed for Alpha.')
  })

  it('preserves package-only filtering without showing action suggestions', async () => {
    const { user, search } = await setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    await user.type(search, 'react@19')
    expect(screen.queryByRole('option', { name: /Open project folder|Run build|Scan for vulnerabilities/ })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View Alpha' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View Beta' })).toBeNull()
  })
})
