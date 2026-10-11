// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { defaultSettings, SETTINGS_STORAGE_KEY } from './lib/settings'
import type { CustomFilter } from './lib/project-filter-state'
import type { RepoProject } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({ alpha: ['Work'] }), saveProjectTags: vi.fn(), clearWorkspace: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
const alpha: RepoProject = { id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'alpha', description: '', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-08T10:00:00Z', dependencies: [{ name: 'react', version: '^18.0.0', kind: 'dependencies' }] }
const beta: RepoProject = { ...alpha, id: 'beta', name: 'Beta', stack: ['Vue'], dependencies: [] }
const preset = (name: string, filters: CustomFilter['filters'] = {}): CustomFilter => ({ id: name, name, filters, query: '', searchScope: 'all', sort: 'name' })
let preferences: Map<string, string>
let setItem: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  preferences = new Map()
  setItem = vi.fn((key: string, value: string) => { preferences.set(key, value) })
  vi.stubGlobal('localStorage', { getItem: (key: string) => preferences.get(key) ?? null, setItem })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  storage.loadWorkspace.mockResolvedValue({ rootName: 'Projects', mode: 'browser', projects: [alpha, beta], syncedAt: alpha.scannedAt })
  storage.loadFavorites.mockResolvedValue(['alpha'])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function setup() {
  const result = render(<App />)
  await screen.findByRole('button', { name: 'View Alpha' })
  return { ...result, user: userEvent.setup() }
}
const saved = (): CustomFilter[] => JSON.parse(preferences.get(SETTINGS_STORAGE_KEY)!).customFilters
const sidebar = () => within(screen.getByRole('navigation', { name: 'Workspace' }))
const customButtons = () => sidebar().getAllByRole('button').slice(5)
const visibleNames = () => screen.queryAllByRole('article').map(card => within(card).getByRole('button', { name: /^View / }).getAttribute('aria-label'))

describe('custom filter shortcuts', () => {
  it('names and saves a combined filter, restores it from another page and after reload, and keeps later edits separate', async () => {
    const { user, unmount } = await setup()
    await user.click(screen.getByRole('button', { name: 'Starred', exact: true }))
    await user.click(within(screen.getByRole('navigation', { name: 'Filter by technology' })).getByRole('button', { name: /^React/ }))
    await user.click(screen.getByRole('button', { name: 'Tags', exact: true }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Work' }))
    await user.keyboard('{Escape}')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'react')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort projects' }), 'name')
    await user.click(screen.getByRole('button', { name: 'Save filter', exact: true }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter name' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter name' }), '  Work React  {Enter}')
    expect(saved()[0]).toMatchObject({ name: 'Work React', filters: { stars: ['starred'], stack: ['React'], tags: ['tag:Work'] }, query: 'react', searchScope: 'packages', sort: 'name' })
    expect(sidebar().getByRole('button', { name: 'Work React' }).getAttribute('aria-current')).toBe('page')
    expect(sidebar().getByRole('button', { name: 'Work React' }).querySelector('svg.lucide-filter')).toBeTruthy()
    expect(sidebar().getByRole('button', { name: 'Todos' }).nextElementSibling).toBe(sidebar().getByRole('button', { name: 'Work React' }))
    expect(screen.queryByText('CUSTOM FILTERS')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save filter', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Clear filters', exact: true }))
    expect(visibleNames()).toHaveLength(2)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'all')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort projects' }), 'updated')
    await user.click(screen.getByRole('button', { name: 'Todos', exact: true }))
    await user.click(sidebar().getByRole('button', { name: 'Work React' }))
    expect(visibleNames()).toEqual(['View Alpha'])
    expect(screen.getByRole('heading', { name: 'Work React', level: 1 })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Search scope' }) as HTMLSelectElement).value).toBe('packages')
    expect((screen.getByRole('combobox', { name: 'Sort projects' }) as HTMLSelectElement).value).toBe('name')
    expect((screen.getByRole('combobox', { name: 'Search projects' }) as HTMLInputElement).value).toBe('react')
    await user.click(screen.getByRole('button', { name: 'Remove Technologies: React' }))
    expect(sidebar().getByRole('button', { name: 'Work React' }).hasAttribute('aria-current')).toBe(false)
    expect(saved()[0].filters.stack).toEqual(['React'])
    unmount()
    await setup()
    await user.click(sidebar().getByRole('button', { name: 'Work React' }))
    expect(visibleNames()).toEqual(['View Alpha'])
    expect(screen.getByRole('button', { name: 'Remove Technologies: React' })).toBeTruthy()
  })

  it('reorders and removes filters in the settings draft, cancels safely, and persists the final order', async () => {
    preferences.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...defaultSettings, customFilters: [preset('React work', { stack: ['React'] }), preset('Vue work', { stack: ['Vue'] }), preset('All work')] }))
    const { user, unmount } = await setup()
    await user.click(sidebar().getByRole('button', { name: 'React work' }))
    const openSettings = async () => {
      await user.click(screen.getByRole('button', { name: 'Settings', exact: true }))
      await user.click(screen.getByRole('tab', { name: 'Custom filters' }))
    }
    await openSettings()
    await user.click(screen.getByRole('button', { name: 'Move React work down' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter name 2' }).closest('li')))
    await user.click(screen.getByRole('button', { name: 'Remove Vue work' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(customButtons().map(button => button.textContent)).toEqual(['React work', 'Vue work', 'All work'])
    await openSettings()
    expect((screen.getByRole('button', { name: 'Move React work up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move All work down' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Move All work up' }))
    await user.click(screen.getByRole('button', { name: 'Remove React work' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(customButtons().map(button => button.textContent)).toEqual(['All work', 'Vue work'])
    expect(screen.queryByRole('heading', { name: 'React work' })).toBeNull()
    expect(visibleNames()).toEqual(['View Alpha'])
    unmount()
    await setup()
    expect(customButtons().map(button => button.textContent)).toEqual(['All work', 'Vue work'])
    await user.click(sidebar().getByRole('button', { name: 'Vue work' }))
    expect(visibleNames()).toEqual(['View Beta'])
  })

  it('renames a filter without changing its identity or criteria, validates names, and persists only saved edits', async () => {
    const original = preset('React work', { stack: ['React'] })
    preferences.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...defaultSettings, customFilters: [original] }))
    const { user, unmount } = await setup()
    await user.click(sidebar().getByRole('button', { name: 'React work' }))
    const openSettings = async () => {
      await user.click(screen.getByRole('button', { name: 'Settings', exact: true }))
      await user.click(screen.getByRole('tab', { name: 'Custom filters' }))
    }
    await openSettings()
    await user.clear(screen.getByRole('textbox', { name: 'Filter name 1' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter name 1' }), 'Unsaved name')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(saved()).toEqual([original])
    expect(sidebar().getByRole('button', { name: 'React work' })).toBeTruthy()
    await openSettings()
    await user.clear(screen.getByRole('textbox', { name: 'Filter name 1' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter name 1' }), '   ')
    await user.click(screen.getByRole('tab', { name: 'Interface' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(screen.getByRole('tab', { name: 'Custom filters' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Filter name 1' }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter a filter name of 1–80 characters.')).toBeTruthy()
    expect(saved()).toEqual([original])
    await user.clear(screen.getByRole('textbox', { name: 'Filter name 1' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter name 1' }), '  Frontend work  ')
    setItem.mockImplementationOnce(() => { throw new Error('Storage blocked') })
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(screen.getByRole('alert').textContent).toContain('Could not save settings')
    expect(saved()).toEqual([original])
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(saved()).toEqual([{ ...original, name: 'Frontend work' }])
    expect(sidebar().getByRole('button', { name: 'Frontend work' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: 'Frontend work', level: 1 })).toBeTruthy()
    expect(visibleNames()).toEqual(['View Alpha'])
    unmount()
    await setup()
    await user.click(sidebar().getByRole('button', { name: 'Frontend work' }))
    expect(visibleNames()).toEqual(['View Alpha'])
  })

  it('handles blank names, cancel, and storage failure without adding an unsaved sidebar entry', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Save filter', exact: true }))
    const dialog = screen.getByRole('dialog', { name: 'Save custom filter' })
    await user.type(screen.getByRole('textbox', { name: 'Filter name' }), '   ')
    expect((within(dialog).getByRole('button', { name: 'Save filter' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole('textbox', { name: 'Filter name' }), 'Unwritten')
    setItem.mockImplementationOnce(() => { throw new Error('Quota exceeded') })
    await user.click(within(dialog).getByRole('button', { name: 'Save filter' }))
    expect(screen.getByRole('alert').textContent).toContain('Could not save settings')
    expect(preferences.has(SETTINGS_STORAGE_KEY)).toBe(false)
    await user.keyboard('{Escape}')
    expect(customButtons()).toHaveLength(0)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save filter', exact: true }))
  })

  it('keeps unavailable selections restrictive and follows settings changes from another tab', async () => {
    const { user } = await setup()
    act(() => {
      preferences.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...defaultSettings, customFilters: [preset('Missing projects', { stack: ['Absent framework'], tags: ['tag:Absent'] })] }))
      window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY }))
    })
    await user.click(sidebar().getByRole('button', { name: 'Missing projects' }))
    expect(visibleNames()).toEqual([])
    expect(screen.getByRole('button', { name: 'Remove Technologies: Absent framework' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Tags: Absent' })).toBeTruthy()
    act(() => {
      preferences.set(SETTINGS_STORAGE_KEY, JSON.stringify(defaultSettings))
      window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY }))
    })
    expect(customButtons()).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Missing projects' })).toBeNull()
    expect(visibleNames()).toEqual([])
  })
})
