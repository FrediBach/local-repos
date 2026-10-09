// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const { chooseDirectory, scanDirectory, saveWorkspace } = vi.hoisted(() => ({ chooseDirectory: vi.fn(), scanDirectory: vi.fn(), saveWorkspace: vi.fn() }))
vi.mock('./lib/deployment', async importOriginal => ({ ...await importOriginal<typeof import('./lib/deployment')>(), isVercelHosted: () => true }))
vi.mock('./lib/storage', () => ({ loadCommitActivity: async () => undefined, saveCommitActivity: async () => {}, loadWorkspace: async () => undefined, loadFavorites: async () => [], saveWorkspace, saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(), clearWorkspace: vi.fn() }))
vi.mock('./lib/filesystem', () => ({ chooseDirectory, scanDirectory, canReadDirectory: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('showDirectoryPicker', vi.fn())
  saveWorkspace.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('explains the hosted limits and keeps browser folder connection usable without offering a helper form', async () => {
  const user = userEvent.setup()
  render(<App />)
  expect(screen.getByRole('dialog', { name: 'Your projects, from the browser.' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Continue browsing' }))
  await user.click(screen.getByRole('button', { name: 'Connect directory', exact: true }))
  const dialog = screen.getByRole('dialog', { name: 'Bring your projects together.' })
  expect(within(dialog).queryByRole('textbox', { name: /Connect with the local helper/ })).toBeNull()
  expect(within(dialog).getByRole('link', { name: 'Installation on GitHub' })).toBeTruthy()
  const handle = { name: 'Projects' }
  chooseDirectory.mockResolvedValue(handle)
  scanDirectory.mockResolvedValue({ rootName: 'Projects', projects: [], syncedAt: '2026-10-07T12:00:00Z' })
  await user.click(within(dialog).getByRole('button', { name: 'Choose a local directory' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(saveWorkspace).toHaveBeenCalledWith(expect.objectContaining({ mode: 'browser', handle }))
  expect(fetch).not.toHaveBeenCalled()
})
