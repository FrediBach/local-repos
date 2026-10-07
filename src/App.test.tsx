// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { RepoProject, ScanResult, Workspace } from './types'

const storage = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  clearWorkspace: vi.fn(),
  loadFavorites: vi.fn(),
  saveFavorites: vi.fn(),
}))

vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => ({
  chooseDirectory: vi.fn(),
  scanDirectory: vi.fn(),
  canReadDirectory: vi.fn(),
}))

const project: RepoProject = {
  id: 'real-project',
  name: 'my-notebook',
  dirName: 'my-notebook',
  relativePath: 'my-notebook',
  description: 'A notebook from the selected local directory.',
  readme: '# My notebook\n\nA notebook from the selected local directory.\n\n## Setup\n\nRun npm run dev.',
  version: '2.0.1',
  author: 'Ada',
  license: 'MIT',
  stack: ['React', 'TypeScript'],
  scripts: { dev: 'vite' },
  packageManager: 'npm',
  git: { branch: 'main', commit: 'abc123abc123', message: 'Add notebooks' },
  scannedAt: '2026-10-07T10:00:00.000Z',
}
const scan: ScanResult = {
  rootName: 'Projects',
  rootPath: '/Users/ada/Projects',
  projects: [project],
  syncedAt: '2026-10-07T10:00:00.000Z',
}

const response = (body: unknown, ok = true) => Promise.resolve({
  ok, json: async () => body,
} as Response)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  storage.loadWorkspace.mockResolvedValue(undefined)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  storage.saveFavorites.mockResolvedValue(undefined)
  storage.clearWorkspace.mockResolvedValue(undefined)
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return response({ ok: true })
    if (url === '/api/scan') return response(scan)
    throw new Error('Unexpected API request: ' + url)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openConnection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Connect directory', exact: true }))
  const dialog = screen.getByRole('dialog', { name: 'Bring your projects together.' })
  await user.type(within(dialog).getByRole('textbox', { name: /Connect with the local helper/ }), '/Users/ada/Projects')
  return dialog
}

describe('project workspace interactions', () => {
  it('returns focus to the project title after opening details from its actions menu', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Actions for margin' }))
    await user.click(screen.getByRole('menuitem', { name: 'Project details' }))
    const dialog = screen.getByRole('dialog', { name: 'margin' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'margin', exact: true }))
  })

  it('supports keyboard tab navigation and returns focus to the project on Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    const opener = screen.getByRole('button', { name: 'View margin' })
    await user.click(opener)
    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview.getAttribute('aria-selected')).toBe('true')
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Packages' }))
    expect(screen.getByRole('tabpanel', { name: 'Packages' })).toBeTruthy()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'README' }).getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(overview)
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'README' }))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(overview)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('runs a bounded package update and clears stale cached reports after refreshing', async () => {
    const user = userEvent.setup()
    const outdated = { manager: 'npm' as const, scannedAt: project.scannedAt, findings: [{ name: 'alpha', current: '1.0.0', latest: '1.0.1', change: 'patch' as const, majorGap: 0, score: 0.1 }], score: 0.1, level: 'low' as const }
    storage.loadWorkspace.mockResolvedValue({ ...scan, mode: 'helper', projects: [{ ...project, outdated }] })
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/update-packages')) return response({ packageUpdate: { level: 'patch', updatedAt: project.scannedAt, packages: [{ name: 'alpha', from: '1.0.0', to: '1.0.1' }], skipped: [] } })
      if (url === '/api/scan') return response({ ...scan, projects: [{ ...project, dependencies: [{ name: 'alpha', version: '1.0.1', kind: 'dependencies' }] }] })
      if (url === '/api/health') return response({ ok: true })
      throw new Error(`Unexpected request ${url}`)
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'View my-notebook' }))
    await user.click(screen.getByRole('tab', { name: 'Packages', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Update patches' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/real-project/update-packages', expect.objectContaining({ body: '{"level":"patch"}' })))
    await waitFor(() => expect(screen.getByText('Outdated packages not scanned yet.')).toBeTruthy())
    const saved = storage.saveWorkspace.mock.calls.at(-1)![0] as Workspace
    expect(saved.projects[0].outdated).toBeUndefined()
    expect(saved.projects[0].dependencies?.[0].version).toBe('1.0.1')
  })

  it('labels demo data, finds a branch, and recovers from an empty search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(storage.loadWorkspace).toHaveBeenCalledOnce())
    expect(screen.getByText('You’re looking at an example workspace.')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(6)

    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'FEAT/EDITOR')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View margin' })).toBeTruthy()

    await user.clear(screen.getByRole('textbox', { name: 'Search projects' }))
    await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'no-such-project')
    expect(screen.getByRole('heading', { name: 'A little too quiet here.' })).toBeTruthy()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('persists favorites and updates the favorite filter when a project is removed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(storage.loadFavorites).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'Favorite margin', exact: true }))
    expect(storage.saveFavorites).toHaveBeenLastCalledWith(['demo-margin'])
    expect(screen.getByRole('button', { name: 'Unfavorite margin' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: /^Favorites/ }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View margin' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Unfavorite margin' }))
    expect(storage.saveFavorites).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('heading', { name: 'Make room for your favorites.' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to all projects' }))
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('switches views and opens the complete README in an accessible project dialog', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(storage.loadWorkspace).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('article')).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: 'View margin' }))
    const dialog = screen.getByRole('dialog', { name: 'margin' })
    expect(within(dialog).getByText('feat/editor')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'README' }))
    expect(within(dialog).getByText(/Install dependencies with npm install, then run npm run dev/)).toBeTruthy()
    expect(within(dialog).getByText(/This is an example project/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('connects a helper directory, replaces sample data, and saves the workspace', async () => {
    const user = userEvent.setup()
    render(<App />)
    const dialog = await openConnection(user)
    await user.click(within(dialog).getByRole('button', { name: 'Connect directory', exact: true }))

    await screen.findByRole('button', { name: 'View my-notebook' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText('You’re looking at an example workspace.')).toBeNull()
    expect(screen.getByText('Local helper workspace')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/scan', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: '/Users/ada/Projects' }),
      headers: expect.objectContaining({ 'X-Local-Repos': '1' }),
    }))
    expect(storage.saveWorkspace).toHaveBeenCalledWith({ ...scan, mode: 'helper' })
    expect(screen.getByRole('status').textContent).toContain('Found 1 project.')
  })

  it('keeps the connect dialog recoverable on a failed scan without replacing the current projects', async () => {
    fetchMock.mockImplementation((url: string) => url === '/api/health'
      ? response({ ok: true })
      : response({ error: 'Directory does not exist or is not readable.' }, false))
    const user = userEvent.setup()
    render(<App />)
    const dialog = await openConnection(user)
    await user.click(within(dialog).getByRole('button', { name: 'Connect directory', exact: true }))

    const error = await within(dialog).findByRole('alert')
    expect(error.textContent).toBe('Directory does not exist or is not readable.')
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect((within(dialog).getByRole('button', { name: 'Connect directory', exact: true }) as HTMLButtonElement).disabled).toBe(false)

    fetchMock.mockImplementation((url: string) => url === '/api/health' ? response({ ok: true }) : response(scan))
    await user.click(within(dialog).getByRole('button', { name: 'Connect directory', exact: true }))
    await screen.findByRole('button', { name: 'View my-notebook' })
    expect(storage.saveWorkspace).toHaveBeenCalledWith({ ...scan, mode: 'helper' })
  })

  it('shows loaded projects while keeping a failed browser-cache save visible', async () => {
    storage.saveWorkspace.mockRejectedValue(new Error('Quota exceeded'))
    const user = userEvent.setup()
    render(<App />)
    const dialog = await openConnection(user)
    await user.click(within(dialog).getByRole('button', { name: 'Connect directory', exact: true }))

    await screen.findByRole('button', { name: 'View my-notebook' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Projects loaded, but browser storage could not save this workspace.')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('restores cached projects and favorites even when the local helper is unavailable', async () => {
    const cached: Workspace = { ...scan, mode: 'helper' }
    storage.loadWorkspace.mockResolvedValue(cached)
    storage.loadFavorites.mockResolvedValue([project.id])
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'View my-notebook' })
    expect(screen.getByRole('button', { name: 'Unfavorite my-notebook' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('Demo workspace')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Favorites/ }))
    expect(screen.getAllByRole('article')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /^Synced/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to fetch')
    expect(screen.getByRole('button', { name: 'View my-notebook' })).toBeTruthy()
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })

  it('does not restore a forgotten workspace when its startup scan finishes later', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...scan, mode: 'helper' })
    let finishScan!: (value: Response) => void
    const pendingScan = new Promise<Response>(resolve => { finishScan = resolve })
    fetchMock.mockImplementation((url: string) => url === '/api/scan' ? pendingScan : response({ ok: true }))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View my-notebook' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/scan', expect.anything()))

    await user.click(screen.getByRole('button', { name: 'How it works' }))
    await user.click(screen.getByRole('button', { name: 'Forget this directory' }))
    await screen.findByText('You’re looking at an example workspace.')
    expect(storage.clearWorkspace).toHaveBeenCalledOnce()

    await act(async () => { finishScan(await response(scan)); await pendingScan })
    expect(screen.queryByRole('button', { name: 'View my-notebook' })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })

  it('keeps a newly selected favorite when cached preferences arrive late', async () => {
    let finishLoading!: (ids: string[]) => void
    const pendingFavorites = new Promise<string[]>(resolve => { finishLoading = resolve })
    storage.loadFavorites.mockReturnValue(pendingFavorites)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Favorite margin', exact: true }))

    await act(async () => { finishLoading([]); await pendingFavorites })
    expect(screen.getByRole('button', { name: 'Unfavorite margin' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /^Favorites/ }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View margin' })).toBeTruthy()
  })
})
