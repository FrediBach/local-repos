import { describe, expect, it } from 'vitest'
import type { GitRepository, RepoProject } from '@/types'
import { groupProjectResults } from './project-groups'
import { filterOptionCounts, matchesProjectFilters, matchesProjectSearch, projectFilterGroups } from './project-filters'
import { matchesFilterState, normalizeCustomFilters } from './project-filter-state'
import { searchSuggestions } from './project-search'
import { defaultSettings } from './settings'
import { hasWorktreeDetails, projectActionLabel, worktreeCountLabel, worktreeNavigation } from './project-worktrees'

const base: RepoProject = { id: 'main', name: 'Atlas', dirName: 'atlas', relativePath: 'atlas', description: '', stack: [], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '2026-10-13T10:00:00Z', git: { branch: 'main', dirty: false }, gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: 'main-tree', checkoutPath: 'atlas', projectPath: '', role: 'main' } }
const linked: RepoProject = { ...base, id: 'linked', relativePath: '.worktrees/atlas-search', git: { branch: 'feat/search', dirty: true }, gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: 'linked-tree', checkoutPath: '.worktrees/atlas-search', projectPath: '', role: 'linked' } }
const packageProject = (root: RepoProject): RepoProject => ({ ...root, id: `${root.id}-web`, name: '@atlas/web', relativePath: `${root.relativePath}/packages/web`, monorepo: { id: root.id, name: root.name, relativePath: root.relativePath, packagePath: 'packages/web' }, gitContext: { ...root.gitContext as Extract<RepoProject['gitContext'], { state: 'verified' }>, projectPath: 'packages/web' } })
const repository: GitRepository = { id: 'repo', name: 'Shared Atlas repository', status: 'complete', checkedAt: base.scannedAt, worktrees: [
  { id: 'main-tree', path: 'atlas', role: 'main', branch: 'main', availability: 'available', projectId: 'main', dirty: false },
  { id: 'linked-tree', path: '.worktrees/atlas-search', role: 'linked', branch: 'feat/search', availability: 'available', projectId: 'linked', dirty: true },
  { id: 'outside', path: '/Volumes/work/atlas', role: 'linked', availability: 'outside' },
] }

describe('worktree browsing', () => {
  it('groups only matching projects and keeps repository and checkout order from the selected sort', () => {
    const member = packageProject(linked)
    const other = { ...base, id: 'other', gitContext: undefined }
    const groups = groupProjectResults([member, other, base, linked], [base, linked, member, other], [repository])
    expect(groups.map(group => group.items.map(item => item.project.id))).toEqual([[member.id, base.id, linked.id], ['other']])
    expect(groups[0].checkouts?.map(checkout => checkout.items.map(item => item.project.id))).toEqual([[member.id, linked.id], [base.id]])
    expect(groupProjectResults([member], [base, linked, member], [repository])[0].items.map(item => item.project.id)).toEqual([member.id])
    expect(groupProjectResults([base], [base], [{ ...repository, worktrees: repository.worktrees.slice(0, 1) }])[0].repository).toBeUndefined()
  })

  it('navigates by matching package path and offers an explicit root fallback without crossing scope or ignore rules', () => {
    const source = packageProject(base)
    const target = packageProject(linked)
    expect(worktreeNavigation(source, repository.worktrees[1], [linked, target])).toMatchObject({ project: target, label: 'View package', packagePath: 'packages/web' })
    expect(worktreeNavigation(source, repository.worktrees[1], [linked])).toMatchObject({ project: linked, label: 'View checkout', missingPackage: 'packages/web' })
    expect(worktreeNavigation(source, repository.worktrees[1], [linked, target], new Set([target.id, linked.id]))).toBeUndefined()
    expect(worktreeNavigation(source, { ...repository.worktrees[1], availability: 'outside' }, [linked, target])).toBeUndefined()
    expect(worktreeNavigation(source, repository.worktrees[1], [{ ...target, gitContext: { ...target.gitContext as Extract<RepoProject['gitContext'], { state: 'verified' }>, repositoryId: 'another-clone' } }])).toBeUndefined()
  })

  it('keeps unresolved evidence separate from confirmed main, linked, and non-Git projects', () => {
    const unknown = { ...base, id: 'unresolved', git: undefined, gitContext: { state: 'unresolved' as const } }
    const older = { ...base, id: 'older', gitContext: undefined }
    const plain = { ...base, id: 'plain', git: undefined, gitContext: undefined }
    const projects = [base, linked, unknown, older, plain]
    const groups = projectFilterGroups(projects)
    const context = { favorites: [linked.id], now: Date.now() }
    expect(projects.filter(project => matchesProjectFilters(project, { worktree: ['unknown'] }, groups, context)).map(project => project.id)).toEqual(['unresolved', 'older'])
    expect(projects.filter(project => matchesProjectFilters(project, { worktree: ['linked'], stars: ['starred'], git: ['dirty'] }, groups, context))).toEqual([linked])
    expect(filterOptionCounts(projects, {}, groups, context).worktree).toMatchObject({ main: 1, linked: 1, unknown: 2 })
    const filter = { id: 'saved', name: 'Linked changes', query: '', searchScope: 'all' as const, sort: 'updated' as const, filters: { worktree: ['linked'], git: ['dirty'] } }
    expect(normalizeCustomFilters([filter])).toEqual([filter])
    expect(matchesFilterState(filter, { ...filter, filters: { worktree: ['main'], git: ['dirty'] } })).toBe(false)
  })

  it('searches repository context while preserving package-only semantics and disambiguates action targets', () => {
    expect(matchesProjectSearch(linked, 'shared atlas', 'all', repository)).toBe(true)
    expect(matchesProjectSearch(linked, 'shared atlas', 'packages', repository)).toBe(false)
    const suggestions = searchSuggestions({ projects: [base, linked], repositories: [repository], favorites: [], settings: defaultSettings, filterGroups: projectFilterGroups([base, linked]), query: 'shared atlas', selection: {}, packagesOnly: false })
    expect(suggestions.filter(suggestion => suggestion.intent.kind === 'project').map(suggestion => suggestion.id)).toEqual(['project:main', 'project:linked'])
    const actions = searchSuggestions({ projects: [base, linked], repositories: [repository], favorites: [], settings: defaultSettings, filterGroups: [], query: 'worktrees', selection: { projectId: linked.id }, packagesOnly: false })
    expect(actions[0]).toMatchObject({ title: 'View worktrees', description: expect.stringContaining('feat/search'), intent: { projectId: linked.id, command: { helper: false, intent: { kind: 'details', tab: 'worktrees' } } } })
    expect(projectActionLabel(linked)).toContain('.worktrees/atlas-search')
  })

  it('does not advertise complete counts or hide failures as an ordinary single checkout', () => {
    expect(worktreeCountLabel({ ...repository, status: 'partial' })).toBe('Worktrees 3+')
    expect(worktreeCountLabel({ ...repository, status: 'unavailable' })).toBe('Worktrees · cached')
    expect(hasWorktreeDetails(base, { ...repository, worktrees: [repository.worktrees[0]] })).toBe(false)
    expect(hasWorktreeDetails(base, { ...repository, worktrees: [repository.worktrees[0]], status: 'unavailable' })).toBe(true)
    expect(hasWorktreeDetails({ ...base, gitContext: { state: 'unresolved' } })).toBe(true)
  })
})
