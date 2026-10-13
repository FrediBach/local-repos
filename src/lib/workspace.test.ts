import { describe, expect, it } from 'vitest'
import { preservePreviews, protectReportRevisions } from './workspace'
import type { GitRepository, LighthouseReport, RepoProject, Workspace } from '../types'

const cachedPng = 'data:image/png;base64,aGVsbG8='

function project(id: string, screenshot?: string): RepoProject {
  return {
    id, name: 'project-' + id, dirName: id, relativePath: id,
    description: 'Project overview', stack: [], scripts: {}, packageManager: 'npm',
    scannedAt: '2026-10-07T10:00:00.000Z', screenshot,
  }
}

function workspace(projects: RepoProject[]): Workspace {
  return {
    rootName: 'Projects', rootPath: '/Users/ada/Projects', mode: 'helper',
    syncedAt: '2026-10-07T10:00:00.000Z', projects,
  }
}

describe('captured preview persistence', () => {
  it('retains dated inventory on failure but accepts authoritative removal and never shares inventories across roots', () => {
    const repository: GitRepository = { id: 'repo', name: 'Repo', checkedAt: '2026-10-13T10:00:00Z', status: 'complete', worktrees: [{ id: 'main', path: 'main', role: 'main', availability: 'available', projectId: 'one' }] }
    const previous = { ...workspace([project('one')]), repositories: [repository] }
    const failed = { ...workspace([project('one')]), repositories: [{ ...repository, status: 'unavailable' as const, checkedAt: '2026-10-13T11:00:00Z', worktrees: [], error: 'Git unavailable' }] }
    expect(preservePreviews(failed, previous).repositories).toEqual([{ ...repository, status: 'unavailable', error: 'Git unavailable' }])
    expect(preservePreviews({ ...failed, rootPath: '/different' }, previous).repositories![0].worktrees).toEqual([])
    expect(preservePreviews({ ...failed, repositories: [] }, previous).repositories).toEqual([])
  })
  it('preserves Lighthouse snapshots across rescans and prefers fresh partial reports for the same ID', () => {
    const lighthouse: LighthouseReport = { scannedAt: '2026-10-10T10:00:00Z', version: '12.8.2', requestedUrl: 'http://localhost:3000/', url: 'http://localhost:3000/', formFactor: 'desktop', categories: [{ id: 'performance', title: 'Performance', score: 88 }], audits: [], warnings: [] }
    const previous = workspace([{ ...project('one'), lighthouse }])
    expect(preservePreviews(workspace([project('one')]), previous).projects[0].lighthouse).toEqual(lighthouse)
    const fresh: LighthouseReport = { ...lighthouse, categories: [{ id: 'performance', title: 'Performance', score: null }], warnings: ['Performance unavailable.'] }
    expect(preservePreviews(workspace([{ ...project('one'), lighthouse: fresh }]), previous).projects[0].lighthouse).toEqual(fresh)
    expect(preservePreviews(workspace([project('two')]), previous).projects[0].lighthouse).toBeUndefined()
  })
  it('keeps dated React Doctor findings after resync, prefers fresh reports and never transfers them to another project', () => {
    const reactDoctor = { scannedAt: '2026-10-09T10:00:00Z', version: '0.9.17', score: 82, label: 'Great', findings: [] }
    const previous = workspace([{ ...project('one'), reactDoctor }])
    expect(preservePreviews(workspace([project('one')]), previous).projects[0].reactDoctor).toEqual(reactDoctor)
    const fresh = { ...reactDoctor, score: null, label: 'Score unavailable', warning: 'Scoring unavailable.' }
    expect(preservePreviews(workspace([{ ...project('one'), reactDoctor: fresh }]), previous).projects[0].reactDoctor).toEqual(fresh)
    expect(preservePreviews(workspace([project('two')]), previous).projects[0].reactDoctor).toBeUndefined()
  })
  it('keeps dated maintenance results across helper restarts and prefers new measurements', () => {
    const storage = { totalBytes: 2048, nodeModulesBytes: 1024, hasNodeModules: true, measuredAt: '2026-10-07T10:00:00Z', partial: false }
    const audit = { manager: 'npm' as const, scannedAt: '2026-10-07T10:00:00Z', counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }, findings: [] }
    const outdated = { manager: 'npm' as const, scannedAt: '2026-10-07T10:00:00Z', findings: [], score: 0, level: 'current' as const }
    const unused = { scannedAt: '2026-10-08T10:00:00Z', knipVersion: '6.40.0', findings: [] }
    const previous = workspace([{ ...project('one'), storage, audit, outdated, unused }])
    expect(preservePreviews(workspace([project('one')]), previous).projects[0]).toMatchObject({ storage, audit, outdated, unused })
    const freshUnused = { ...unused, scannedAt: '2026-10-08T11:00:00Z' }
    expect(preservePreviews(workspace([{ ...project('one'), unused: freshUnused }]), previous).projects[0].unused).toEqual(freshUnused)
    expect(preservePreviews(workspace([project('two')]), previous).projects[0].unused).toBeUndefined()
    const freshStorage = { ...storage, totalBytes: 1024, nodeModulesBytes: 0, hasNodeModules: false }
    expect(preservePreviews(workspace([{ ...project('one'), storage: freshStorage }]), previous).projects[0].storage).toEqual(freshStorage)
    expect(preservePreviews(workspace([project('two')]), previous).projects[0].audit).toBeUndefined()
    expect(preservePreviews(workspace([project('two')]), previous).projects[0].outdated).toBeUndefined()
    const freshOutdated = { ...outdated, scannedAt: '2026-10-08T10:00:00Z' }
    expect(preservePreviews(workspace([{ ...project('one'), outdated: freshOutdated }]), previous).projects[0].outdated).toEqual(freshOutdated)
  })
  it('retains cached PNG data when a rescan or helper restart loses its temporary screenshot', () => {
    const preview = { url: 'https://example.com/app', source: 'github' as const, capturedAt: '2026-10-07T10:00:00.000Z' }
    const previous = workspace([{ ...project('one', cachedPng), preview }])
    const rescanned = workspace([{ ...project('one'), version: '2.0.0', description: 'Updated from disk' }])

    const result = preservePreviews(rescanned, previous)
    expect(result.projects[0]).toMatchObject({
      id: 'one', screenshot: cachedPng, preview, version: '2.0.0', description: 'Updated from disk',
    })
    expect(rescanned.projects[0].screenshot).toBeUndefined()
    expect(previous.projects[0].description).toBe('Project overview')
  })

  it('keeps durable PNG data when the helper returns a temporary URL for the same project', () => {
    const previous = workspace([project('one', cachedPng)])
    const next = workspace([project('one', '/api/screenshots/one.png')])
    expect(preservePreviews(next, previous).projects[0].screenshot).toBe(cachedPng)
  })

  it('retains the asset kind and repository provenance with a cached image after resync', () => {
    const preview: NonNullable<RepoProject['preview']> = { kind: 'favicon', source: 'repository', assetPath: 'public/favicon.ico', capturedAt: '2026-10-07T10:00:00.000Z' }
    const previous = workspace([{ ...project('one', cachedPng), preview }])
    const rescanned = workspace([project('one')])
    expect(preservePreviews(rescanned, previous).projects[0]).toMatchObject({ screenshot: cachedPng, preview })
  })

  it('never assigns a removed project’s preview to another project', () => {
    const previous = workspace([project('old-id', cachedPng)])
    const next = workspace([{ ...project('new-id'), name: previous.projects[0].name }])
    const result = preservePreviews(next, previous)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].id).toBe('new-id')
    expect(result.projects[0].screenshot).toBeUndefined()
  })

  it('keeps fresh scan URLs when there is no durable cached image', () => {
    const fresh = '/api/screenshots/new.png'
    const next = workspace([project('one', fresh)])
    expect(preservePreviews(next).projects[0].screenshot).toBe(fresh)
    const previous = workspace([project('one', '/api/screenshots/expired.png')])
    expect(preservePreviews(next, previous).projects[0].screenshot).toBe(fresh)
  })
})


describe('helper report reconciliation', () => {
  const report = { scannedAt: '2026-10-09T10:00:00Z', version: '0.9.17', score: 82, label: 'Great', findings: [] }
  const state = (revision: number, validity: 'available' | 'invalidated' | 'missing', helperInstanceId = 'boot_a') => ({ helperInstanceId, revision, validity })
  it('keeps newer worktree membership and metadata while merging a fresh report from an older workspace', () => {
    const removed = project('removed')
    const newlyDiscovered = project('new')
    const context: RepoProject['gitContext'] = { state: 'verified', repositoryId: 'repo', worktreeId: 'main', checkoutPath: 'new-path', projectPath: '.', role: 'main' }
    const inventory: GitRepository = { id: 'repo', name: 'Repo', checkedAt: '2026-10-13T11:00:00Z', status: 'complete', worktrees: [{ id: 'main', path: 'new-path', projectId: 'one', role: 'main', availability: 'available' }] }
    const previous: Workspace = { ...workspace([{ ...project('one'), name: 'Current name', relativePath: 'new-path', gitContext: context, git: { branch: 'new-branch' }, reactDoctor: report, reportState: { reactDoctor: state(9, 'available') } }, newlyDiscovered]), helperInstanceId: 'boot_a', revision: 9, repositories: [inventory], warnings: ['Current warning'], syncedAt: '2026-10-13T11:00:00Z' }
    const fresh = { ...report, score: 95, scannedAt: '2026-10-13T11:01:00Z' }
    const stale: Workspace = { ...workspace([{ ...project('one'), git: { branch: 'old-branch' }, reactDoctor: fresh, reportState: { reactDoctor: state(10, 'available') } }, removed]), helperInstanceId: 'boot_a', revision: 8, repositories: [{ ...inventory, worktrees: [...inventory.worktrees, { id: 'old', path: 'removed', projectId: 'removed', role: 'linked', availability: 'available' }] }], warnings: ['Old warning'] }
    const result = protectReportRevisions(stale, previous)
    expect(result).toMatchObject({ revision: 9, syncedAt: previous.syncedAt, warnings: previous.warnings, repositories: previous.repositories })
    expect(result.projects.map(project => project.id)).toEqual(['one', 'new'])
    expect(result.projects[0]).toMatchObject({ name: 'Current name', relativePath: 'new-path', gitContext: context, git: { branch: 'new-branch' }, reactDoctor: fresh, reportState: { reactDoctor: state(10, 'available') } })
    expect(stale.projects.map(project => project.id)).toEqual(['one', 'removed'])
  })

  it('accepts authoritative empty inventory and does not reuse topology from another helper instance', () => {
    const previous: Workspace = { ...workspace([]), helperInstanceId: 'boot_a', revision: 9, repositories: [] }
    const stale: Workspace = { ...workspace([project('removed')]), helperInstanceId: 'boot_a', revision: 8, repositories: [{ id: 'old', name: 'Old', checkedAt: '2026-10-13', status: 'complete', worktrees: [] }] }
    expect(protectReportRevisions(stale, previous)).toMatchObject({ projects: [], repositories: [], revision: 9 })
    const restarted = { ...stale, helperInstanceId: 'boot_b', revision: 1 }
    expect(protectReportRevisions(restarted, previous).projects).toHaveLength(1)
    expect(protectReportRevisions(restarted, previous).repositories).toEqual(restarted.repositories)
  })
  it('keeps tombstones through late scans and accepts only a newer successful report', () => {
    const saved = workspace([{ ...project('one'), reactDoctor: report, reportState: { reactDoctor: state(1, 'available') } }])
    const invalidated = preservePreviews(workspace([{ ...project('one'), reportState: { reactDoctor: state(2, 'invalidated') } }]), saved)
    expect(invalidated.projects[0].reactDoctor).toBeUndefined()
    const late = preservePreviews(saved, invalidated)
    expect(late.projects[0].reactDoctor).toBeUndefined()
    expect(late.projects[0].reportState?.reactDoctor?.revision).toBe(2)
    const staleWrite = protectReportRevisions({ ...saved, helperInstanceId: 'boot_a', revision: 1 }, { ...invalidated, helperInstanceId: 'boot_a', revision: 2 })
    expect(staleWrite.projects[0].reactDoctor).toBeUndefined()
    expect(staleWrite.revision).toBe(2)
    const invalidatingWrite = protectReportRevisions({ ...saved, helperInstanceId: 'boot_a', projects: [{ ...saved.projects[0], reportState: { reactDoctor: state(2, 'invalidated') } }] }, { ...saved, helperInstanceId: 'boot_a' })
    expect(invalidatingWrite.projects[0].reactDoctor).toBeUndefined()
    expect(preservePreviews(workspace([project('one')]), late).projects[0].reactDoctor).toBeUndefined()
    const fresh = preservePreviews(workspace([{ ...project('one'), reactDoctor: report, reportState: { reactDoctor: state(3, 'available') } }]), late)
    expect(fresh.projects[0].reactDoctor).toEqual(report)
  })
  it('retains successful snapshots with unknown freshness after a restart', () => {
    const saved = workspace([{ ...project('one'), reactDoctor: report, reportState: { reactDoctor: state(100, 'available') } }])
    const restored = preservePreviews(workspace([{ ...project('one'), reportState: { reactDoctor: state(0, 'missing', 'boot_b') } }]), saved)
    expect(restored.projects[0].reactDoctor).toEqual(report)
    expect(restored.projects[0].reportState?.reactDoctor).toMatchObject({ helperInstanceId: 'boot_b', validity: 'unknown' })
    const fresh = { ...report, score: 99 }
    const afterLazyRegistration = protectReportRevisions({ ...saved, helperInstanceId: 'boot_a', projects: [{ ...saved.projects[0], reactDoctor: fresh, reportState: { reactDoctor: state(1, 'available', 'boot_b') } }] }, { ...saved, helperInstanceId: 'boot_a' })
    expect(afterLazyRegistration.projects[0].reactDoctor).toEqual(fresh)
  })
  it('does not replace a new external preview with an older cached image', () => {
    const old = workspace([{ ...project('one', cachedPng), preview: { source: 'local', capturedAt: '2026-10-01' } }])
    const next = workspace([{ ...project('one', '/api/screenshots/new.png'), preview: { source: 'local', capturedAt: '2026-10-02' } }])
    expect(preservePreviews(next, old).projects[0].screenshot).toBe('/api/screenshots/new.png')
  })
})

it('retains ignored IDs across scans of the same workspace, including temporarily missing projects', () => {
  const previous = { ...workspace([project('one')]), ignoredProjectIds: ['one'] }
  expect(preservePreviews(workspace([]), previous).ignoredProjectIds).toEqual(['one'])
  expect(preservePreviews({ ...workspace([]), rootPath: '/another-root' }, previous).ignoredProjectIds).toBeUndefined()
})
