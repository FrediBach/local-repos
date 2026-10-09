// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { RepoProject } from './types'
import type { ProjectTags } from './lib/project-tags'

const storage = vi.hoisted(() => ({ loadWorkspace: vi.fn(), loadFavorites: vi.fn(), loadProjectTags: vi.fn(), saveProjectTags: vi.fn(), saveWorkspace: vi.fn(), saveFavorites: vi.fn(), clearWorkspace: vi.fn() }))
vi.mock('./lib/storage', () => ({ ...storage, loadCommitActivity: async () => undefined, saveCommitActivity: async () => {} }))
const base: RepoProject = { id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'alpha', description: 'Workspace app', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-08T10:00:00Z' }
const projects = [base, { ...base, id: 'beta', name: 'Beta', stack: ['Vue'] }, { ...base, id: 'gamma', name: 'Gamma' }]
const workspace = { rootName: 'Projects', rootPath: '/projects', mode: 'helper', projects, syncedAt: base.scannedAt }
let savedTags: ProjectTags

beforeEach(() => {
  vi.resetAllMocks()
  savedTags = { alpha: ['work'], beta: ['private'] }
  storage.loadWorkspace.mockResolvedValue(workspace)
  storage.loadFavorites.mockResolvedValue(['alpha'])
  storage.loadProjectTags.mockImplementation(async () => savedTags)
  storage.saveProjectTags.mockImplementation(async tags => { savedTags = tags })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/scan' ? workspace : { ok: true } })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function setup() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Edit tags for Alpha' })
  return user
}
const visibleNames = () => screen.queryAllByRole('article').map(card => within(card).getByRole('button', { name: /^View / }).getAttribute('aria-label'))

describe('project tags', () => {
  it('adds suggestions and custom tags, merges case variants, and preserves tags through rescan and reload', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Edit tags for Alpha' }))
    const editor = screen.getByRole('dialog', { name: 'Tags for Alpha' })
    const input = within(editor).getByRole('textbox', { name: 'Add a tag' })
    expect(document.activeElement).toBe(input)
    await user.click(within(editor).getByRole('button', { name: 'contributing', exact: true }))
    await user.type(input, '  WORK  {Enter}')
    expect(within(editor).getAllByRole('button', { name: 'Remove tag work' })).toHaveLength(1)
    await user.type(input, ' Side   Project ')
    await user.click(within(editor).getByRole('button', { name: 'Save tags' }))
    expect(savedTags).toEqual({ alpha: ['contributing', 'side project', 'work'], beta: ['private'] })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit tags for Alpha' }))
    await user.click(screen.getByRole('button', { name: /Synced/ }))
    await waitFor(() => expect(storage.saveWorkspace).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Filter by tag: side project' })).toBeTruthy()
    cleanup()
    await setup()
    expect(screen.getByRole('button', { name: 'Filter by tag: side project' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter by tag: private' })).toBeTruthy()
  })

  it('combines tag choices with other filters and searches in both views, including untagged projects', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Tags', exact: true }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'work', exact: true }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'private', exact: true }))
    await user.keyboard('{Escape}')
    expect(visibleNames()).toEqual(['View Alpha', 'View Beta'])
    await user.click(screen.getByRole('button', { name: 'Starred', exact: true }))
    expect(visibleNames()).toEqual(['View Alpha'])
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(visibleNames()).toEqual(['View Alpha'])
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.type(screen.getByRole('combobox', { name: 'Search projects' }), 'PRIVATE')
    expect(visibleNames()).toEqual(['View Beta'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search scope' }), 'packages')
    expect(visibleNames()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.click(screen.getByRole('button', { name: /^All filters/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Untagged' }))
    expect(visibleNames()).toEqual(['View Gamma'])
    await user.click(screen.getByRole('button', { name: 'Close filters' }))
    await user.click(screen.getByRole('button', { name: 'Remove Tags: Untagged' }))
    expect(visibleNames()).toHaveLength(3)
  })

  it('cancels edits, retains drafts after a failed save, and recovers when removing the last matching tag', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Edit tags for Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Remove tag work' }))
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(savedTags.alpha).toEqual(['work'])
    await user.click(screen.getByRole('button', { name: 'Filter by tag: work' }))
    expect(visibleNames()).toEqual(['View Alpha'])
    await user.click(screen.getByRole('button', { name: 'Edit tags for Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Remove tag work' }))
    storage.saveProjectTags.mockRejectedValueOnce(new Error('Quota exceeded'))
    await user.click(screen.getByRole('button', { name: 'Save tags' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(savedTags.alpha).toEqual(['work'])
    await user.click(screen.getByRole('button', { name: 'Save tags' }))
    expect(savedTags.alpha).toBeUndefined()
    expect(visibleNames()).toEqual([])
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Search projects' }))
    await user.click(screen.getByRole('button', { name: 'Remove Tags: work' }))
    expect(visibleNames()).toHaveLength(3)
  })

  it('edits from project details and from its actions menu with focus restored', async () => {
    storage.loadWorkspace.mockResolvedValue({ ...workspace, mode: 'browser' })
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'View Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Edit tags', exact: true }))
    await user.click(screen.getByRole('button', { name: 'private', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Save tags' }))
    const detail = screen.getByRole('dialog', { name: 'Alpha' })
    expect(document.activeElement).toBe(within(detail).getByRole('button', { name: 'Edit tags', exact: true }))
    await user.click(within(detail).getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit tags' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Alpha', exact: true }))
  })

  it('waits for saved tags to load before allowing edits', async () => {
    let resolve!: (tags: ProjectTags) => void
    storage.loadProjectTags.mockReturnValue(new Promise<ProjectTags>(done => { resolve = done }))
    render(<App />)
    const add = await screen.findByRole('button', { name: 'Add tags for Alpha' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolve({ alpha: ['work'] }))
    expect((screen.getByRole('button', { name: 'Edit tags for Alpha' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
