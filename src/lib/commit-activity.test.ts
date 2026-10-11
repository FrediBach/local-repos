import { describe, expect, it } from 'vitest'
import { aggregateCommitActivity, commitRepositoryId, previewCommitActivity, validCommitActivity, type CachedCommitActivity } from './commit-activity'
import type { RepoProject } from '@/types'
const root: RepoProject = { id: 'root', name: 'Root', dirName: 'root', relativePath: 'root', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { branch: 'main' } }
const child = { ...root, id: 'child', monorepo: { id: 'root', name: 'Root', relativePath: 'root', packagePath: 'child' } }
const report: CachedCommitActivity = { from: '2026-01-01', to: '2026-10-08', cachedAt: '2026-10-08T12:00:00Z', shallow: false, activity: [{ date: '2026-10-08', count: 3 }] }
describe('cached global activity', () => {
  it('stays absent without usable cached reports', () => {
    expect(aggregateCommitActivity([root], {})).toBeUndefined()
    expect(validCommitActivity({ ...report, activity: [{ date: 'bad', count: -1 }] })).toBe(false)
  })
  it('counts monorepo history once, aggregates repositories, and ignores other workspaces', () => {
    const other = { ...root, id: 'other' }
    expect(commitRepositoryId(child, new Map([root, child].map(project => [project.id, project])))).toBe('root')
    const result = aggregateCommitActivity([root, child, other], { root: report, child: report, other: report, unrelated: report }, '2026-10-09')!
    expect(result.repositories).toBe(2)
    expect(result.days.find(day => day.date === '2026-10-08')).toMatchObject({ count: 6, covered: 2, partial: false })
    expect(result.days.at(-1)).toMatchObject({ date: '2026-10-09', count: 0, covered: 0, partial: true })
    expect(result.days.length).toBeLessThanOrEqual(91)
  })
  it('distinguishes known empty days from missing, shallow, and uncached coverage', () => {
    const result = aggregateCommitActivity([root, { ...root, id: 'uncached' }], { root: report }, '2026-10-09')!
    expect(result.days.find(day => day.date === '2026-10-07')).toMatchObject({ count: 0, covered: 1, partial: true })
    expect(aggregateCommitActivity([root], { root: { ...report, shallow: true } }, '2026-10-08')!.days.at(-1)?.partial).toBe(true)
    expect(aggregateCommitActivity([root], { root: { ...report, activity: [] } }, '2026-10-08')).toBeDefined()
  })
  it('resolves nested parents and stops at missing parents or cycles', () => {
    const grandchild = { ...child, id: 'grandchild', monorepo: { ...child.monorepo, id: child.id } }
    const projects = new Map([root, child, grandchild].map(project => [project.id, project]))
    expect(commitRepositoryId(grandchild, projects)).toBe(root.id)
    projects.delete(root.id)
    expect(commitRepositoryId(grandchild, projects)).toBe(child.id)
    projects.set(child.id, { ...child, monorepo: { ...child.monorepo, id: grandchild.id } })
    expect(commitRepositoryId(grandchild, projects)).toBe(grandchild.id)
  })
})

describe('preview activity', () => {
  it('uses 90 UTC dates in order and distinguishes missing coverage from zero commits', () => {
    const activity = previewCommitActivity({ ...report, from: '2026-10-01' }, 'ada@example.com', '2026-10-09')
    expect(activity.days).toHaveLength(90)
    expect(activity.days[0]).toEqual({ date: '2026-07-12', count: undefined })
    expect(activity.days.find(day => day.date === '2026-10-01')).toEqual({ date: '2026-10-01', count: 0 })
    expect(activity.days.at(-2)).toEqual({ date: '2026-10-08', count: 3 })
    expect(activity.days.at(-1)).toEqual({ date: '2026-10-09', count: undefined })
    expect(activity.author).toBe('ada@example.com')
    expect(activity.cachedAt).toBe(report.cachedAt)
  })

  it('handles leap days, old caches, and shallow histories without inventing recent activity', () => {
    const leap = previewCommitActivity({ ...report, from: '2024-01-01', to: '2024-03-01', shallow: true, activity: [{ date: '2024-02-29', count: 2 }] }, '', '2024-03-01')
    expect(leap.days[0].date).toBe('2023-12-03')
    expect(leap.days.at(-2)).toEqual({ date: '2024-02-29', count: 2 })
    expect(leap.shallow).toBe(true)
    expect(previewCommitActivity(report, '', '2027-02-01').days.every(day => day.count === undefined)).toBe(true)
  })
})
