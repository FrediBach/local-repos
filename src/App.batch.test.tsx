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
  saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(),
}))
const previews = vi.hoisted(() => ({ cachePreview: vi.fn() }))

vi.mock('./lib/storage', () => storage)
vi.mock('./lib/filesystem', () => ({
  chooseDirectory: vi.fn(),
  scanDirectory: vi.fn(),
  canReadDirectory: vi.fn(),
}))
vi.mock('./lib/workspace', async () => ({
  ...await vi.importActual<typeof import('./lib/workspace')>('./lib/workspace'),
  cachePreview: previews.cachePreview,
}))

function project(id: string, name: string): RepoProject {
  return {
    id, name, dirName: id, relativePath: id,
    description: `The ${name} project.`,
    stack: ['React'], scripts: { dev: 'vite' }, packageManager: 'npm',
    scannedAt: '2026-10-07T10:00:00.000Z',
    screenshot: `data:image/png;base64,old-${id}`,
  }
}
const projects = [project('alpha', 'Alpha notebook'), project('bravo', 'Bravo site'), project('charlie', 'Charlie tools')]
const scan: ScanResult = {
  rootName: 'Projects', rootPath: '/Users/ada/Projects', projects,
  syncedAt: '2026-10-07T10:00:00.000Z',
}
const workspace: Workspace = { ...scan, mode: 'helper' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}
function captured(id: string) {
  return {
    screenshot: `/api/screenshots/${id}.png`,
    preview: { url: `http://127.0.0.1:5181/${id}`, source: 'local', capturedAt: '2026-10-07T12:00:00.000Z' },
    dev: { status: 'stopped' },
  }
}
const cachedImage = (id: string) => `data:image/png;base64,new-${id}`

let fetchMock: ReturnType<typeof vi.fn>
let pending: Record<string, ReturnType<typeof deferred<Response>>>
const screenshotRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/screenshot'))

beforeEach(() => {
  vi.resetAllMocks()
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue([])
  storage.saveWorkspace.mockResolvedValue(undefined)
  storage.saveFavorites.mockResolvedValue(undefined)
  storage.clearWorkspace.mockResolvedValue(undefined)
  previews.cachePreview.mockImplementation(async (url: string) => cachedImage(url.split('/').at(-1)!.replace('.png', '')))
  pending = Object.fromEntries(projects.map(item => [item.id, deferred<Response>()]))
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/health') return Promise.resolve(response({ ok: true }))
    if (url === '/api/scan') return Promise.resolve(response(scan))
    const id = /^\/api\/projects\/([^/]+)\/screenshot$/.exec(url)?.[1]
    if (id && pending[id]) return pending[id].promise
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
  const result = render(<App />)
  await screen.findByRole('button', { name: 'View Alpha notebook' })
  storage.saveWorkspace.mockClear()
  return { user, ...result }
}
async function complete(id: string, body: unknown = captured(id), ok = true) {
  await act(async () => {
    pending[id].resolve(response(body, ok))
    await pending[id].promise
  })
}
function progress() {
  return screen.getByRole('progressbar', { name: 'Preview capture progress' })
}

describe('workspace preview capture queue', () => {
  it('captures sequentially, reports completed work, and updates and caches every image before the next capture', async () => {
    const { user } = await renderConnected()
    const firstImage = deferred<string>()
    previews.cachePreview.mockReturnValueOnce(firstImage.promise)
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))

    expect(screenshotRequests()).toHaveLength(1)
    expect(screenshotRequests()[0]).toEqual(['/api/projects/alpha/screenshot', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ source: 'auto' }),
    })])
    expect(progress().getAttribute('aria-valuemax')).toBe('3')
    expect(progress().getAttribute('aria-valuenow')).toBe('0')
    expect(progress().getAttribute('aria-valuetext')).toContain('capturing Alpha notebook')
    expect(within(screen.getByRole('button', { name: 'View Alpha notebook' })).getByText('Capturing preview')).toBeTruthy()
    expect(storage.saveWorkspace).not.toHaveBeenCalled()

    await complete('alpha')
    expect(previews.cachePreview).toHaveBeenCalledWith('/api/screenshots/alpha.png')
    expect(screenshotRequests()).toHaveLength(1)
    expect(progress().getAttribute('aria-valuenow')).toBe('0')
    await act(async () => { firstImage.resolve(cachedImage('alpha')); await firstImage.promise })
    await waitFor(() => expect(screenshotRequests()).toHaveLength(2))
    expect(screenshotRequests()[1][0]).toBe('/api/projects/bravo/screenshot')
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    expect(progress().getAttribute('aria-valuetext')).toContain('capturing Bravo site')
    expect(within(screen.getByRole('button', { name: 'View Alpha notebook' })).queryByText('Capturing preview')).toBeNull()
    expect(within(screen.getByRole('button', { name: 'View Bravo site' })).getByText('Capturing preview')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Screenshot of Alpha notebook' }).getAttribute('src')).toBe(cachedImage('alpha'))
    expect(screen.getByRole('img', { name: 'Screenshot of Bravo site' }).getAttribute('src')).toBe(projects[1].screenshot)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ id: 'alpha', screenshot: cachedImage('alpha') }), projects[1], projects[2]],
    }))

    await complete('bravo')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(3))
    expect(screenshotRequests()[2][0]).toBe('/api/projects/charlie/screenshot')
    expect(progress().getAttribute('aria-valuenow')).toBe('2')
    expect(screen.getByRole('img', { name: 'Screenshot of Bravo site' }).getAttribute('src')).toBe(cachedImage('bravo'))
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({ screenshot: cachedImage('alpha') }), expect.objectContaining({ screenshot: cachedImage('bravo') }), projects[2]],
    }))

    await complete('charlie')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Capture previews', exact: true }) as HTMLButtonElement).disabled).toBe(false))
    expect(progress().getAttribute('aria-valuenow')).toBe('3')
    expect(screen.getByText('Preview capture complete')).toBeTruthy()
    expect(screen.getByText('3 captured')).toBeTruthy()
    expect(screen.getByText('0 failed')).toBeTruthy()
    expect(screen.queryByText('Capturing preview')).toBeNull()
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(3)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: projects.map(item => expect.objectContaining({ id: item.id, screenshot: cachedImage(item.id) })),
    }))
    expect(screen.getByRole('img', { name: 'Screenshot of Charlie tools' }).getAttribute('src')).toBe(cachedImage('charlie'))
    await user.click(screen.getByRole('button', { name: 'Dismiss capture progress' }))
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('continues after a failed capture, keeps its previous image, and retains the error in the result', async () => {
    const { user } = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await complete('alpha', { error: 'The project did not render any visible content.' }, false)

    await waitFor(() => expect(screenshotRequests()).toHaveLength(2))
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    expect(screen.getByRole('img', { name: 'Screenshot of Alpha notebook' }).getAttribute('src')).toBe(projects[0].screenshot)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    await complete('bravo')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(3))
    await complete('charlie')

    await waitFor(() => expect(progress().getAttribute('aria-valuenow')).toBe('3'))
    expect(screen.getByText('2 captured')).toBeTruthy()
    expect(screen.getByText('1 failed')).toBeTruthy()
    await user.click(screen.getByText('1 capture failed — view details'))
    expect(screen.getByText(/The project did not render any visible content\./)).toBeTruthy()
    expect(storage.saveWorkspace).toHaveBeenCalledTimes(2)
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: [projects[0], expect.objectContaining({ screenshot: cachedImage('bravo') }), expect.objectContaining({ screenshot: cachedImage('charlie') })],
    }))
  })

  it('stops after the active capture and keeps that completed image', async () => {
    const { user } = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screenshotRequests()).toHaveLength(1)

    await complete('alpha')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Capture previews', exact: true }) as HTMLButtonElement).disabled).toBe(false))
    expect(screenshotRequests()).toHaveLength(1)
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    expect(progress().getAttribute('aria-valuemax')).toBe('3')
    expect(screen.getByText('Preview capture stopped')).toBeTruthy()
    expect(screen.getByText('1 captured')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Screenshot of Alpha notebook' }).getAttribute('src')).toBe(cachedImage('alpha'))
    expect(storage.saveWorkspace).toHaveBeenCalledOnce()
  })

  it('locks conflicting workspace and project actions until the queue finishes', async () => {
    const { user } = await renderConnected()
    const captureButton = screen.getByRole('button', { name: 'Capture previews', exact: true }) as HTMLButtonElement
    await user.click(captureButton)
    expect(captureButton.disabled).toBe(true)
    await user.click(captureButton)
    expect(screenshotRequests()).toHaveLength(1)
    for (const button of screen.getAllByRole('button', { name: 'Change directory', exact: true })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
      await user.click(button)
    }
    expect(screen.queryByRole('dialog')).toBeNull()
    const sync = screen.getByRole('button', { name: /^Synced/ }) as HTMLButtonElement
    expect(sync.disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'How it works' }))
    const forgetButton = screen.getByRole('button', { name: 'Forget this directory' }) as HTMLButtonElement
    expect(forgetButton.disabled).toBe(true)
    await user.click(forgetButton)
    expect(storage.clearWorkspace).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    await user.click(screen.getByRole('button', { name: 'View Bravo site' }))
    const dialog = screen.getByRole('dialog', { name: 'Bravo site' })
    for (const name of ['Start server', 'Logs', 'Capture preview', 'VS Code', 'Sourcetree']) {
      expect((within(dialog).getByRole('button', { name, exact: true }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screenshotRequests()).toHaveLength(1)
  })

  it('captures the entire workspace even when the visible list is filtered', async () => {
    const { user } = await renderConnected()
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'Bravo site')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    expect(progress().getAttribute('aria-valuemax')).toBe('3')
    expect(screenshotRequests()[0][0]).toBe('/api/projects/alpha/screenshot')
    await complete('alpha')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(2))
    await complete('bravo')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(3))
    expect(screen.getByRole('img', { name: 'Screenshot of Bravo site' }).getAttribute('src')).toBe(cachedImage('bravo'))
    await complete('charlie')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('continues after browser storage fills and reports the images available for this session', async () => {
    const { user } = await renderConnected()
    storage.saveWorkspace.mockRejectedValueOnce(new Error('Quota exceeded'))
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await complete('alpha')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(2))
    expect(screen.getByRole('img', { name: 'Screenshot of Alpha notebook' }).getAttribute('src')).toBe(cachedImage('alpha'))
    expect(screen.getByText(/1 preview could not be saved in browser storage/)).toBeTruthy()
    await complete('bravo')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(3))
    await complete('charlie')

    expect(screen.getByText('3 captured')).toBeTruthy()
    expect(screen.getByText('0 failed')).toBeTruthy()
    expect(screen.queryByText(/could not be saved in browser storage/)).toBeNull()
    expect(storage.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      projects: projects.map(item => expect.objectContaining({ id: item.id, screenshot: cachedImage(item.id) })),
    }))
  })

  it('does not start another project or save stale work after unmount', async () => {
    const { user, unmount } = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    expect(screenshotRequests()).toHaveLength(1)
    unmount()
    await complete('alpha')
    expect(screenshotRequests()).toHaveLength(1)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })

  it('captures cached projects without an unsolicited startup rescan', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha notebook' })
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await complete('alpha')
    await waitFor(() => expect(screenshotRequests()).toHaveLength(2))
    expect(storage.saveWorkspace).toHaveBeenCalledOnce()

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/scan')).toBe(false)
    expect(screen.getByRole('img', { name: 'Screenshot of Alpha notebook' }).getAttribute('src')).toBe(cachedImage('alpha'))
    expect(storage.saveWorkspace).toHaveBeenCalledOnce()
    expect(progress().getAttribute('aria-valuenow')).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    await complete('bravo')
    expect(screenshotRequests()).toHaveLength(2)
  })

  it('asks browser-only workspaces to connect the local helper before capturing', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser' })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'View Alpha notebook' })
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    expect(screen.getByRole('dialog', { name: 'Bring your projects together.' })).toBeTruthy()
    expect(screenshotRequests()).toHaveLength(0)
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
  })
})
