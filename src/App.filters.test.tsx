// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { RepoProject } from './types'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), loadProjectTags: async () => ({}), saveProjectTags: vi.fn(), clearWorkspace: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
const base: RepoProject = { id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'alpha', description: 'Workspace app', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-08T10:00:00Z' }
const projects: RepoProject[] = [
  { ...base, audit: { manager: 'npm', scannedAt: base.scannedAt, counts: { critical: 1, high: 0, moderate: 0, low: 0, info: 0 }, findings: [] }, outdated: { manager: 'npm', scannedAt: base.scannedAt, findings: [{ name: 'react', current: '18.0.0', latest: '19.0.0', majorGap: 1, score: 10, change: 'major' }], level: 'moderate', score: 10 }, dependencies: [{ name: 'react', version: '^18.0.0', kind: 'dependencies' }], dev: { status: 'running' } },
  { ...base, id: 'beta', name: 'Beta', stack: ['Vue'], audit: { manager: 'npm', scannedAt: base.scannedAt, counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, findings: [] }, outdated: { manager: 'npm', scannedAt: base.scannedAt, findings: [], level: 'current', score: 0 }, dev: { status: 'stopped' } },
  { ...base, id: 'gamma', name: 'Gamma', stack: ['Svelte', 'Astro', 'Go', 'Rust', 'Python', 'Ruby', 'Rare framework'], packageManager: 'pnpm', author: 'Grace Hopper' },
]

beforeEach(() => {
  vi.resetAllMocks()
  storage.loadWorkspace.mockResolvedValue({ rootName: 'Projects', mode: 'browser', projects, syncedAt: base.scannedAt })
  storage.loadFavorites.mockResolvedValue(['alpha', 'beta'])
  storage.saveFavorites.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function setup() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'View Alpha' })
  return user
}
const visibleNames = () => screen.queryAllByRole('article').map(card => within(card).getByRole('button', { name: /^View / }).getAttribute('aria-label'))

describe('composable workspace filters', () => {
  it('combines favorites, security, updates, technology and package search in both views', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /^Favorites/ }))
    await user.click(screen.getByRole('button', { name: 'Outdated packages', exact: true }))
    await user.click(screen.getByRole('button', { name: /^All filters/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Vulnerabilities' }), 'critical')
    await user.click(screen.getByRole('button', { name: 'Technologies Any' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'React' }))
    await user.keyboard('{Escape}')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'react@18.2.0')
    expect(visibleNames()).toEqual(['View Alpha'])
    expect(screen.getByRole('button', { name: 'Starred', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(visibleNames()).toEqual(['View Alpha'])
    await user.click(screen.getByRole('button', { name: 'Remove Vulnerabilities: Critical severity' }))
    expect((screen.getByRole('combobox', { name: 'Outdated packages' }) as HTMLSelectElement).value).toBe('outdated')
    expect((screen.getByRole('combobox', { name: 'Search projects' }) as HTMLInputElement).value).toBe('react@18.2.0')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(visibleNames()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Starred', exact: true }).getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps clean and unscanned projects separate and recovers from conflicting filters', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /^All filters/ }))
    const audit = screen.getByRole('combobox', { name: 'Vulnerabilities' })
    await user.selectOptions(audit, 'clean')
    expect(visibleNames()).toEqual(['View Beta'])
    await user.selectOptions(audit, 'unscanned')
    expect(visibleNames()).toEqual(['View Gamma'])
    await user.click(screen.getByRole('button', { name: 'Starred', exact: true }))
    expect(visibleNames()).toEqual([])
    expect(screen.getByText('0 of 3 projects')).toBeTruthy()
    expect(within(audit).getByRole('option', { name: 'No reported vulnerabilities · 1' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove Stars: Starred projects' }))
    expect(visibleNames()).toEqual(['View Gamma'])
    await user.click(screen.getByRole('button', { name: 'Close filters' }))
    expect(screen.getByRole('button', { name: 'Remove Vulnerabilities: Not scanned for vulnerabilities' })).toBeTruthy()
  })

  it('offers all technologies and keeps sidebar selections in sync without clearing other filters', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /^All filters/ }))
    await user.click(screen.getByRole('button', { name: 'Technologies Any' }))
    await user.type(screen.getByRole('searchbox', { name: 'Find a technology' }), 'Rare')
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Rare framework' }))
    expect(visibleNames()).toEqual(['View Gamma'])
    await user.clear(screen.getByRole('searchbox', { name: 'Find a technology' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'React' }))
    expect(visibleNames()).toEqual(['View Alpha', 'View Gamma'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Starred', exact: true }))
    expect(visibleNames()).toEqual(['View Alpha'])
    const sidebar = screen.getByRole('navigation', { name: 'Filter by technology' })
    expect(within(sidebar).getByRole('button', { name: /^React/ }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(sidebar).getByRole('button', { name: /^Vue/ }))
    expect(visibleNames()).toEqual(['View Alpha', 'View Beta'])
    expect(screen.getByRole('button', { name: 'Starred', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /^Technologies / }))
    await user.type(screen.getByRole('searchbox', { name: 'Find a technology' }), 'Rare')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.click(screen.getByRole('button', { name: 'Technologies Any' }))
    expect((screen.getByRole('searchbox', { name: 'Find a technology' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Svelte' })).toBeTruthy()
  })

  it('supports keyboard search, group clearing, and nested Escape dismissal', async () => {
    const user = await setup()
    const allFilters = screen.getByRole('button', { name: /^All filters/ })
    await user.click(allFilters)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Vulnerabilities' }), 'unscanned')
    const technologies = screen.getByRole('button', { name: 'Technologies Any' })
    technologies.focus()
    await user.keyboard('{ArrowDown}{ArrowUp}')
    const search = screen.getByRole('searchbox', { name: 'Find a technology' })
    expect(document.activeElement).toBe(search)
    await user.keyboard('Rare framework{ArrowDown}{Enter}')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rare framework' }).getAttribute('aria-checked')).toBe('true')
    expect(visibleNames()).toEqual(['View Gamma'])
    await user.click(search)
    await user.clear(search)
    await user.type(search, 'nothing matches')
    expect(within(screen.getByRole('menu', { name: 'Filter by technologies' })).getByRole('status').textContent).toBe('No matches.')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rare framework' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Clear technologies' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rare framework' }).getAttribute('aria-checked')).toBe('false')
    expect(visibleNames()).toEqual(['View Gamma'])
    expect((screen.getByRole('combobox', { name: 'Vulnerabilities' }) as HTMLSelectElement).value).toBe('unscanned')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(technologies)
    expect(screen.getByRole('region', { name: 'Project filters' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Project filters' })).toBeNull()
    expect(document.activeElement).toBe(allFilters)
  })

  it('updates the result immediately when a visible project is unstarred and supports maintenance sorting', async () => {
    const user = await setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort projects' }), 'vulnerabilities')
    expect(visibleNames()).toEqual(['View Alpha', 'View Beta', 'View Gamma'])
    await user.click(screen.getByRole('button', { name: 'Starred', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Unfavorite Alpha' }))
    expect(visibleNames()).toEqual(['View Beta'])
    expect(storage.saveFavorites).toHaveBeenLastCalledWith(['beta'])
    await user.click(screen.getByRole('button', { name: /^Running servers/ }))
    expect(visibleNames()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Back to all projects' }))
    expect(visibleNames()).toHaveLength(3)
  })
})
