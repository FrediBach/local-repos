import { describe, expect, it } from 'vitest'
import { aggregateCommitActivity, commitRepositoryId, validCommitActivity, type CachedCommitActivity } from './commit-activity'
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
    expect(commitRepositoryId(child, [root, child])).toBe('root')
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
})
