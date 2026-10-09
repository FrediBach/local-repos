// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { RepoProject } from './types'
import { createConfigBackup, type ConfigBackup } from './lib/config-backup'
import { defaultSettings, SETTINGS_STORAGE_KEY } from './lib/settings'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), loadProjectTags: vi.fn(), saveProjectTags: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), saveConfigPreferences: vi.fn(), clearWorkspace: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
const project = (id: string, origin?: string): RepoProject => ({ id, name: id, dirName: id, relativePath: id, description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { origin } })
const projects = [project('alpha', 'https://github.com/team/app'), project('extra')]
const workspace = { rootName: 'Projects', mode: 'browser', projects, syncedAt: '' }
let preferences: Map<string, string>
let download: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  preferences = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, value: string) => preferences.set(key, value) })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue(['extra'])
  storage.loadProjectTags.mockResolvedValue({ alpha: ['local'], extra: ['keep'] })
  storage.saveConfigPreferences.mockImplementation(async (backup, favorites, tags) => {
    preferences.set(SETTINGS_STORAGE_KEY, JSON.stringify(backup.settings))
    preferences.set('local-repos:theme', backup.theme)
    storage.loadFavorites.mockResolvedValue(favorites)
    storage.loadProjectTags.mockResolvedValue(tags)
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:config'), revokeObjectURL: vi.fn() }))
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function setup() {
  render(<App />)
  const user = userEvent.setup()
  await screen.findByRole('button', { name: 'View alpha' })
  await user.click(screen.getByRole('button', { name: 'Settings', exact: true }))
  await user.click(screen.getByRole('tab', { name: 'Backup' }))
  return user
}
const backup = () => createConfigBackup({ ...defaultSettings, colorScheme: 'ocean', projectTagLimit: 0 }, 'dark', [project('old-alpha', 'git@github.com:team/app.git'), project('missing')], ['old-alpha'], { 'old-alpha': ['work'] })
const upload = (user: ReturnType<typeof userEvent.setup>, value: unknown) => user.upload(screen.getByLabelText('Configuration JSON file'), new File([JSON.stringify(value)], 'config.json', { type: 'application/json' }))

describe('configuration backup controls', () => {
  it('downloads a versioned JSON containing saved settings, favorites and tags', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(download).toHaveBeenCalledOnce()
    expect(download.mock.instances[0].download).toMatch(/^local-repos-config-\d{4}-\d{2}-\d{2}\.json$/)
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
    const exported: ConfigBackup = JSON.parse(text)
    expect(exported).toMatchObject({ format: 'local-repos-config', version: 1, settings: defaultSettings, theme: 'system' })
    expect(exported.projects).toMatchObject([{ id: 'alpha', favorite: false, tags: ['local'] }, { id: 'extra', favorite: true, tags: ['keep'] }])
    expect(screen.getByRole('status').textContent).toContain('exported')
  })

  it('imports moved repos, reports missing entries, updates the settings draft and theme, and survives reload', async () => {
    const user = await setup()
    const value = backup()
    await upload(user, value)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 project(s) matched; 1 missing'))
    expect(storage.saveConfigPreferences).toHaveBeenCalledWith(value, ['extra', 'alpha'], { alpha: ['local', 'work'], extra: ['keep'] })
    expect(storage.saveWorkspace).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.colorScheme).toBe('ocean')
    await user.click(screen.getByRole('tab', { name: 'Interface' }))
    expect((screen.getByRole('radio', { name: 'Ocean' }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(screen.getByRole('button', { name: 'Unfavorite alpha' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unfavorite extra' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter by tag: work' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter by tag: keep' })).toBeTruthy()
    cleanup()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Unfavorite alpha' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Filter by tag: work' })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Color theme' }) as HTMLSelectElement).value).toBe('dark')
  })

  it('rejects malformed files without saving, and allows retrying the same file after a storage failure', async () => {
    const user = await setup()
    await upload(user, { unexpected: true })
    expect((await screen.findByRole('alert')).textContent).toContain('Local Repos configuration')
    expect(storage.saveConfigPreferences).not.toHaveBeenCalled()
    storage.saveConfigPreferences.mockRejectedValueOnce(new Error('Could not save the configuration. Your preferences were kept.'))
    const value = backup()
    await upload(user, value)
    expect((await screen.findByRole('alert')).textContent).toContain('Your preferences were kept')
    expect(document.documentElement.dataset.colorScheme).toBe('forest')
    await upload(user, value)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('imported'))
  })
})
