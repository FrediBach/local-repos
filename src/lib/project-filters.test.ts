import { describe, expect, it } from 'vitest'
import { filterOptionCounts, matchesProjectFilters, matchesProjectSearch, projectFilterGroups, sortProjects, type ProjectFilters } from './project-filters'
import type { PackageAudit, PackageOutdated, RepoProject } from '../types'

const now = Date.parse('2026-10-08T12:00:00Z')
const context = { favorites: ['alpha'], now }
const audit: PackageAudit = { manager: 'npm', scannedAt: new Date(now).toISOString(), counts: { critical: 1, high: 0, moderate: 0, low: 0, info: 0 }, findings: [] }
const outdated: PackageOutdated = { manager: 'npm', scannedAt: audit.scannedAt, findings: [{ name: 'react', current: '18.0.0', latest: '19.0.0', change: 'major', majorGap: 1, score: 10 }], score: 10, level: 'moderate' }
const base: RepoProject = { id: 'alpha', name: 'Alpha', description: '', dirName: 'alpha', relativePath: 'apps/alpha', stack: ['React', 'TypeScript'], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: audit.scannedAt }
const projects: RepoProject[] = [
  { ...base, audit, outdated, git: { dirty: true, branch: 'main' }, updatedAt: '2026-10-07T12:00:00Z' },
  { ...base, id: 'beta', name: 'Beta', stack: ['Vue'], packageManager: 'pnpm', audit: { ...audit, counts: { ...audit.counts, critical: 0 } }, outdated: { ...outdated, findings: [], score: 0, level: 'current' }, git: { dirty: false }, updatedAt: '2025-01-01T12:00:00Z' },
  { ...base, id: 'gamma', name: 'Gamma', stack: ['Svelte'], git: { branch: 'main' } },
  { ...base, id: 'delta', name: 'Delta', outdated: { ...outdated, findings: [], score: 0, level: 'current', skipped: [{ name: 'local-lib', reason: 'Workspace dependency' }] } },
]
const groups = projectFilterGroups(projects)
const matching = (filters: ProjectFilters) => projects.filter(p => matchesProjectFilters(p, filters, groups, context)).map(p => p.id)

describe('project filtering', () => {
  it('combines stars, maintenance, and technologies with OR inside a group and AND between groups', () => {
    expect(matching({ stars: ['starred'], audit: ['vulnerable'], outdated: ['major'], stack: ['Vue', 'React'] })).toEqual(['alpha'])
    expect(matching({ stack: ['Vue', 'React'] })).toEqual(['alpha', 'beta', 'delta'])
    expect(matching({ stars: ['starred'], manager: ['pnpm'] })).toEqual([])
  })

  it('uses audit counts and keeps unknown audits separate from clean scans', () => {
    expect(matching({ audit: ['critical'] })).toEqual(['alpha'])
    expect(matching({ audit: ['clean'] })).toEqual(['beta'])
    expect(matching({ audit: ['unscanned'] })).toEqual(['gamma', 'delta'])
  })

  it('never calls skipped or unscanned packages up to date', () => {
    expect(matching({ outdated: ['current'] })).toEqual(['beta'])
    expect(matching({ outdated: ['partial'] })).toEqual(['delta'])
    expect(matching({ outdated: ['unscanned'] })).toEqual(['gamma'])
  })

  it('keeps unknown Git and storage states separate from clean or absent data', () => {
    expect(matching({ git: ['clean'] })).toEqual(['beta'])
    expect(matching({ git: ['unknown'] })).toEqual(['gamma'])
    expect(matching({ git: ['none'] })).toEqual(['delta'])
    expect(matching({ storage: ['missing'] })).toEqual([])
    expect(matching({ storage: ['unmeasured'] })).toHaveLength(4)
  })

  it('does not mistake a fresh scan for recent project activity', () => {
    expect(matching({ activity: ['week'] })).toEqual(['alpha'])
    expect(matching({ activity: ['year'] })).toEqual(['beta'])
    expect(matching({ activity: ['unknown'] })).toEqual(['gamma', 'delta'])
    expect(matchesProjectFilters({ ...base, git: { committedAt: '2026-10-01T12:00:00Z' } }, { activity: ['week'] }, groups, context)).toBe(true)
  })

  it('counts each option against the other selected groups and the searched candidates', () => {
    const counts = filterOptionCounts(projects, { stars: ['starred'], audit: ['clean'] }, groups, context)
    expect(counts.audit).toMatchObject({ vulnerable: 1, clean: 0, unscanned: 0 })
    expect(counts.stars).toMatchObject({ starred: 0, unstarred: 1 })
    expect(filterOptionCounts(projects.filter(p => p.id === 'beta'), {}, groups, context).audit.vulnerable).toBe(0)
  })

  it('retains a selected technology or branch after its last project disappears', () => {
    const filters = { stack: ['Old framework'], branch: ['deleted-branch'] }
    const nextGroups = projectFilterGroups(projects, filters)
    expect(nextGroups.find(g => g.key === 'stack')?.options.some(o => o.value === 'Old framework')).toBe(true)
    expect(projects.some(p => matchesProjectFilters(p, filters, nextGroups, context))).toBe(false)
  })

  it('searches added metadata while keeping package scope and version matching intact', () => {
    const p = { ...base, author: 'Ada Lovelace', license: 'MIT', dependencies: [{ name: '@acme/ui', version: '^2.0.0', kind: 'dependencies' as const }] }
    expect(matchesProjectSearch(p, 'LOVELACE', 'all')).toBe(true)
    expect(matchesProjectSearch(p, 'apps/alpha', 'all')).toBe(true)
    expect(matchesProjectSearch(p, 'MIT', 'packages')).toBe(false)
    expect(matchesProjectSearch(p, '@acme/ui@2.4.0', 'packages')).toBe(true)
    expect(matchesProjectSearch(p, '@acme/ui@3.0.0', 'packages')).toBe(false)
  })

  it('prioritizes severity over raw counts and puts unknown reports and dates last', () => {
    const manyLow = { ...projects[1], audit: { ...audit, counts: { ...audit.counts, critical: 0, low: 99 } } }
    expect(sortProjects([projects[2], manyLow, projects[0]], 'vulnerabilities', []).map(p => p.id)).toEqual(['alpha', 'beta', 'gamma'])
    expect(sortProjects(projects, 'outdated', []).map(p => p.id)).toEqual(['alpha', 'beta', 'delta', 'gamma'])
    expect(sortProjects(projects, 'oldest', []).map(p => p.id)).toEqual(['beta', 'alpha', 'delta', 'gamma'])
    expect(projects[0].id).toBe('alpha')
  })

  it('matches workspace, previews, and measured dependency folders independently', () => {
    const p = { ...base, monorepo: { id: 'root', name: 'Suite', relativePath: '.', packagePath: 'apps/alpha' }, screenshot: 'data:image/png;base64,test', storage: { totalBytes: 2 * 1024 ** 3, nodeModulesBytes: 0, hasNodeModules: false, partial: true, measuredAt: audit.scannedAt } }
    expect(matchesProjectFilters(p, { structure: ['member'], preview: ['captured'], storage: ['large'] }, groups, context)).toBe(true)
    expect(matchesProjectFilters(p, { storage: ['installed'] }, groups, context)).toBe(false)
    expect(sortProjects([base, p], 'size', [])[0]).toBe(p)
    expect(matchesProjectFilters({ ...base, dev: { status: 'starting' } }, { server: ['running'] }, groups, context)).toBe(true)
  })
})
