import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { branchCount, dayRange, formatDailyReport, summaryCommits, summaryRepositories, type SummaryResult } from './daily-summary'
import type { RepoProject } from '../types'

const project = { id: 'root', name: 'Root', relativePath: 'root' } as RepoProject
const commit = { hash: 'abc1234567890', author: 'Alice', email: 'alice@example.com', message: 'Ship feature', committedAt: '2026-10-08T10:00:00Z', branches: [{ ref: 'refs/heads/main', name: 'main', remote: false }] }
const results: SummaryResult[] = [
  { project, data: { available: true, shallow: false, commits: [commit] } },
  { project: { id: 'second', name: 'Second', relativePath: 'second' }, data: { available: true, shallow: true, commits: [{ ...commit, author: 'Bob', email: 'bob@example.com', committedAt: '2026-10-08T08:00:00Z' }] } },
  { project: { id: 'third', name: 'Third', relativePath: 'third' }, error: 'Repository unavailable' },
]

describe('daily summary reporting', () => {
  it('deduplicates nested monorepo members even when the roots arrive later', () => {
    const member = { ...project, id: 'member', monorepo: { id: 'inner', name: 'Inner', relativePath: 'root/inner', packagePath: 'web' } }
    const inner = { ...project, id: 'inner', monorepo: { id: 'root', name: 'Root', relativePath: 'root', packagePath: 'inner' } }
    expect(summaryRepositories([member, inner, project])).toEqual([{ id: 'root', name: 'Root', relativePath: 'root' }])
  })

  it('sorts across projects, preserves equal hashes in different repositories and combines exact filters', () => {
    const commits = summaryCommits(results)
    expect(commits.map(commit => commit.project.id)).toEqual(['second', 'root'])
    expect(branchCount(commits)).toBe(2)
    expect(summaryCommits(results, 'root', 'alice@example.com')).toHaveLength(1)
    expect(summaryCommits(results, 'root', 'bob@example.com')).toEqual([])
    expect(summaryCommits(results, '', 'alice.*')).toEqual([])
  })

  it('exports project descriptions, branch labels, chronological commits and coverage notes', () => {
    const text = formatDailyReport('2026-10-08', summaryCommits(results, '', 'alice@example.com'), results, 'alice@example.com')
    expect(text).toContain('Author: alice@example.com')
    expect(text).toContain('1 commit · 1 project · 1 branch')
    expect(text).toContain('Root (root)')
    expect(text).toContain('- Ship feature')
    expect(text).toContain('[abc1234]')
    expect(text).toContain('Branches: main')
    expect(text).toContain('Second: shallow clone')
    expect(text).toContain('Third: Repository unavailable')
    expect(text).toContain('not hours worked')
    expect(text).not.toContain('· Bob ·')
  })

  it('rejects invalid dates and calculates local midnights across DST boundaries', () => {
    for (const day of ['', '2026-02-30', '2026-13-01', '--all']) expect(dayRange(day)).toBeUndefined()
    // Run in a real process timezone rather than relying on the test worker's TZ.
    const ranges = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import { dayRange } from './src/lib/daily-summary.ts'; console.log(JSON.stringify(['2026-03-29','2026-10-25','2026-10-08'].map(dayRange)))"], { env: { ...process.env, TZ: 'Europe/Zurich' }, encoding: 'utf8' }))
    expect(ranges).toEqual([
      { from: '2026-03-28T23:00:00.000Z', to: '2026-03-29T22:00:00.000Z' },
      { from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' },
      { from: '2026-10-07T22:00:00.000Z', to: '2026-10-08T22:00:00.000Z' },
    ])
  })
})
