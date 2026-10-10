import { describe, expect, it } from 'vitest'
import { mergeRemoteActivity, newRemoteItems, remoteActivityProjects, remoteRepository } from './remote-activity'
import { preservePreviews } from './workspace'
import type { RemoteActivityReport, RepoProject, Workspace } from '../types'

const project: RepoProject = { id: 'one', name: 'One', dirName: 'one', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { origin: 'https://github.com/team/repo' } }
const report: RemoteActivityReport = { repository: 'https://github.com/team/repo', scannedAt: '2026-10-10T12:00:00Z', issues: [1, 2], pullRequests: [3] }
const workspace = (p: RepoProject): Workspace => ({ mode: 'helper', rootName: 'root', rootPath: '/root', projects: [p], syncedAt: '' })

describe('repository identity and new items', () => {
  it('accepts SSH origins and GitLab subgroups but excludes unknown hosts and malformed repository paths', () => {
    expect(remoteRepository({ git: { origin: 'git@github.com:team/repo.git' } })?.url).toBe(report.repository)
    expect(remoteRepository({ git: { origin: 'ssh://git@gitlab.com/team/sub/repo.git' } })?.path).toBe('team/sub/repo')
    for (const origin of ['https://github.com.evil.test/team/repo', 'https://localhost/team/repo', 'https://github.com/team/repo/issues', 'https://gitlab.com/team/-/issues', 'https://github.com:444/team/repo', 'https://github.com/team/repo?x=1', 'https://github.com/team/%2e%2e']) {
      expect(remoteRepository({ git: { origin } }), origin).toBeUndefined()
    }
  })
  it('establishes a baseline and detects new IDs even when counts stay the same', () => {
    expect(newRemoteItems(undefined, report)).toEqual({ issues: 0, pullRequests: 0 })
    expect(newRemoteItems(report, { ...report, issues: [2, 4], pullRequests: [5] })).toEqual({ issues: 1, pullRequests: 1 })
    expect(newRemoteItems(report, { ...report, issues: [2] })).toEqual({ issues: 0, pullRequests: 0 })
    expect(newRemoteItems(report, { ...report, repository: 'https://github.com/other/repo' })).toEqual({ issues: 0, pullRequests: 0 })
  })
  it('deduplicates shared repositories and merges results onto every matching project', () => {
    const sibling = { ...project, id: 'two' }
    const unrelated = { ...project, id: 'three', git: { origin: 'https://gitlab.com/team/repo' } }
    expect(remoteActivityProjects([project, sibling, unrelated]).map(p => p.id)).toEqual(['one', 'three'])
    expect(mergeRemoteActivity([project, sibling, unrelated], { remoteActivity: report }).map(p => p.remoteActivity)).toEqual([report, report, undefined])
  })
  it('preserves cached counts across helper restarts but clears them when the remote changes', () => {
    const saved = workspace({ ...project, remoteActivity: report })
    expect(preservePreviews(workspace(project), saved).projects[0].remoteActivity).toEqual(report)
    expect(preservePreviews(workspace({ ...project, git: { origin: 'https://github.com/other/repo' } }), saved).projects[0].remoteActivity).toBeUndefined()
    expect(preservePreviews(workspace({ ...project, git: undefined }), saved).projects[0].remoteActivity).toBeUndefined()
  })
})
