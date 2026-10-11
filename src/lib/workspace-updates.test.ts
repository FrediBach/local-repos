import { describe, expect, it } from 'vitest'
import type { AuditFinding, AuditSeverity, PackageAudit, PackageOutdated, ReactDoctorFinding, RepoProject } from '../types'
import { newWorkspaceUpdates, rememberWorkspaceReports } from './workspace-updates'

const before = '2026-10-10T10:00:00Z'
const after = '2026-10-10T11:00:00Z'
const later = '2026-10-10T12:00:00Z'
const project: RepoProject = {
  id: 'app', name: 'App', dirName: 'app', relativePath: 'app', description: '', stack: [], scripts: {},
  packageManager: 'npm', scannedAt: before, git: { origin: 'https://github.com/team/app' },
}
const finding: AuditFinding = { name: 'unsafe', severity: 'high', title: 'Unsafe input', url: 'https://example.test/advisory/1' }
const audit = (findings: AuditFinding[] = [], scannedAt = after, counts: Partial<Record<AuditSeverity, number>> = {}): PackageAudit => ({
  manager: 'npm', scannedAt, findings,
  counts: { ...Object.fromEntries(['info', 'low', 'moderate', 'high', 'critical'].map(severity => [severity, findings.filter(item => !item.suppression && item.severity === severity).length])) as Record<AuditSeverity, number>, ...counts },
})
const activity = (issues: number[], pullRequests: number[], scannedAt = after) => ({ repository: 'https://github.com/team/app', scannedAt, issues, pullRequests })
const outdated = (scannedAt = after, level: PackageOutdated['level'] = 'high'): PackageOutdated => ({
  manager: 'npm', scannedAt, level, score: 100,
  findings: [{ name: 'old', current: '1.0.0', latest: '11.0.0', change: 'major', majorGap: 10, score: 100 }],
})
const error: ReactDoctorFinding = { filePath: 'src/App.tsx', line: 12, column: 1, plugin: 'react', rule: 'hooks', severity: 'error', message: 'Conditional hook', help: '', category: 'React' }
const doctor = (findings = [error], scannedAt = after) => ({ version: '1', scannedAt, score: 70, label: 'Good', findings })
const updates = (old: Partial<RepoProject>, next: Partial<RepoProject>) => newWorkspaceUpdates([{ ...project, ...old }], [{ ...project, ...next }])

describe('new workspace updates', () => {
  it('baselines newly added projects and cached reports, but detects a first fresh audit', () => {
    const saved = { ...project, audit: audit([finding]) }
    expect(newWorkspaceUpdates([], [saved])).toEqual([])
    expect(newWorkspaceUpdates([saved], [{ ...saved, tags: ['changed'] }])).toEqual([])
    expect(updates({}, { audit: audit([finding]) })).toEqual([expect.objectContaining({ projectId: 'app', scope: 'app', kind: 'security', category: 'vulnerability' })])
  })

  it('classifies every severity, ignores suppression, and reports newly unsuppressed findings', () => {
    const findings = ['info', 'low', 'moderate', 'high', 'critical'].map(severity => ({ ...finding, name: severity, severity: severity as AuditSeverity }))
    expect(updates({}, { audit: audit(findings) }).map(update => update.kind)).toEqual(['warning', 'warning', 'warning', 'security', 'security'])
    const suppressed = { ...finding, suppression: { source: '.trivyignore', ids: ['CVE-2026-1234'] } }
    expect(updates({}, { audit: audit([suppressed]) })).toEqual([])
    expect(updates({ audit: audit([suppressed], before) }, { audit: audit([finding]) })).toHaveLength(1)
  })

  it('finds equal-count advisory replacements and escalations without reporting downgrades', () => {
    const original = audit([finding], before)
    expect(updates({ audit: original }, { audit: audit([{ ...finding, title: 'Another advisory' }]) })).toHaveLength(1)
    expect(updates({ audit: original }, { audit: audit([{ ...finding, severity: 'critical' }]) })).toHaveLength(1)
    expect(updates({ audit: original }, { audit: audit([{ ...finding, severity: 'moderate' }]) })).toEqual([])
    const low = updates({}, { audit: audit([{ ...finding, severity: 'low' }]) })[0]
    const escalated = updates({ audit: audit([{ ...finding, severity: 'low' }], before) }, { audit: audit([finding]) })[0]
    expect(low.key).toBe(escalated.key)
  })

  it('keeps identities stable through report ordering, ranges, and fix availability', () => {
    const original = { ...finding, title: 'Issue B; Issue A' }
    const changed = { ...finding, title: 'Issue A; Issue B', range: '<3', fixAvailable: true }
    expect(updates({ audit: audit([original], before) }, { audit: audit([changed, changed], after, { high: 1 }) })).toEqual([])
    expect(updates({}, { audit: audit([changed, changed], after, { high: 1 }) })).toHaveLength(1)
  })

  it('adds summary-only count growth without counting detailed growth twice', () => {
    expect(updates({ audit: audit([], before, { high: 1 }) }, { audit: audit([], after, { high: 3 }) })).toHaveLength(2)
    expect(updates({ audit: audit([], before, { high: 3 }) }, { audit: audit([], after, { high: 3 }) })).toEqual([])
    expect(updates({ audit: audit([], before, { high: 3 }) }, { audit: audit([], after, { high: 2 }) })).toEqual([])
    expect(updates({ audit: audit([], before, { high: 1 }) }, { audit: audit([finding], after, { high: 3 }) })).toHaveLength(2)
  })

  it('deduplicates shared lockfile findings while keeping independent packages distinct', () => {
    const one = { ...project, monorepo: { id: 'root', name: 'Root', relativePath: '.', packagePath: 'app' } }
    const two = { ...one, id: 'second' }
    const next = [one, two].map(item => ({ ...item, audit: audit([finding]) }))
    expect(newWorkspaceUpdates([one, two], next)).toHaveLength(1)
    expect(newWorkspaceUpdates([one, two], next)[0].scope).toBe('root')
    expect(newWorkspaceUpdates([one, { ...two, audit: audit([finding], before) }], next)).toEqual([])
    expect(newWorkspaceUpdates([one, two], next.map(item => ({ ...item, monorepo: { ...item.monorepo, declaredWorkspace: false } })))).toHaveLength(2)
  })

  it('uses a first remote report as a baseline and catches replacements, reopenings, and shared origins', () => {
    const old = { ...project, remoteActivity: activity([1], [2], before) }
    const next = { ...project, remoteActivity: activity([3], [4]) }
    expect(updates({}, next)).toEqual([])
    expect(newWorkspaceUpdates([old], [next]).map(update => update.category)).toEqual(['issue', 'pull-request'])
    expect(newWorkspaceUpdates([old], [next]).every(update => update.scope === 'https://github.com/team/app')).toBe(true)
    expect(newWorkspaceUpdates([old, { ...old, id: 'second' }], [next, { ...next, id: 'second' }])).toHaveLength(2)
    const closed = { ...project, remoteActivity: activity([], [], after) }
    expect(newWorkspaceUpdates([old], [closed])).toEqual([])
    expect(newWorkspaceUpdates([closed], [{ ...old, remoteActivity: activity([1], [2], later) }])).toHaveLength(2)
  })

  it('resets remote baselines when origins change and rejects mismatched reports', () => {
    const old = { ...project, remoteActivity: activity([], [], before) }
    const next = { ...project, git: { origin: 'https://gitlab.com/team/app' }, remoteActivity: { ...activity([1], [2]), repository: 'https://gitlab.com/team/app' } }
    expect(newWorkspaceUpdates([old, { ...next, id: 'other', remoteActivity: { ...next.remoteActivity, scannedAt: before } }], [next])).toEqual([])
    expect(newWorkspaceUpdates([old], [{ ...next, git: project.git }])).toEqual([])
  })

  it('reports new high-priority dependencies and errors, ignoring warnings, line shifts, and configuration-only changes', () => {
    const current = { outdated: outdated(), reactDoctor: doctor() }
    expect(updates({}, current).map(update => update.category)).toEqual(['dependency', 'react-doctor'])
    expect(updates({}, current).map(update => update.kind)).toEqual(['activity', 'activity'])
    expect(updates({}, { outdated: outdated(after, 'moderate'), reactDoctor: doctor([{ ...error, severity: 'warning' }]) })).toEqual([])
    expect(updates({ outdated: outdated(before), reactDoctor: doctor([error], before) }, { outdated: outdated(), reactDoctor: doctor([{ ...error, line: 99 }]) })).toEqual([])
    expect(updates({ outdated: outdated(after, 'moderate') }, { outdated: outdated() })).toEqual([])
    expect(updates({ outdated: outdated(before, 'moderate') }, { outdated: outdated() }).map(update => update.category)).toEqual(['dependency'])
    expect(updates({ reactDoctor: doctor([error], before) }, { reactDoctor: doctor([error, { ...error, line: 99 }]) })).toHaveLength(1)
  })

  it('ignores stale, undated, invalidated, unknown, and incomplete reports', () => {
    const old = { audit: audit([], after), remoteActivity: activity([], [], after), outdated: outdated(after, 'current'), reactDoctor: doctor([], after) }
    const changed = { audit: audit([finding], before), remoteActivity: activity([1], [2], before), outdated: outdated(before), reactDoctor: doctor([error], before) }
    expect(updates(old, changed)).toEqual([])
    expect(updates({}, { audit: audit([finding], '') })).toEqual([])
    for (const validity of ['invalidated', 'missing', 'unknown'] as const) {
      expect(updates({}, { audit: audit([finding]), reportState: { audit: { helperInstanceId: 'boot', revision: 2, validity } } })).toEqual([])
    }
    expect(updates({}, { reactDoctor: { ...doctor(), label: 'Incomplete scan' } })).toEqual([])
  })
})

describe('remembered workspace reports', () => {
  const saved = { ...project, audit: audit([finding], before), outdated: outdated(before), reactDoctor: doctor([error], before), remoteActivity: activity([1], [2], before) }

  it('retains last successful reports through missing and invalidated refreshes', () => {
    const next = { ...project, reportState: { audit: { helperInstanceId: 'boot', revision: 2, validity: 'invalidated' as const } } }
    const remembered = rememberWorkspaceReports([saved], [next])
    expect(remembered[0]).toMatchObject({ audit: saved.audit, outdated: saved.outdated, reactDoctor: saved.reactDoctor, remoteActivity: saved.remoteActivity })
    expect(newWorkspaceUpdates(remembered, [{ ...saved, audit: audit([finding], after) }])).toEqual([])
  })

  it('keeps complete doctor reports across partial scans so existing errors are not new again', () => {
    const partial = { ...project, reactDoctor: { ...doctor([], after), label: 'Incomplete scan' } }
    const remembered = rememberWorkspaceReports([saved], [partial])
    expect(remembered[0].reactDoctor).toBe(saved.reactDoctor)
    expect(newWorkspaceUpdates(remembered, [{ ...project, reactDoctor: doctor([error], later) }])).toEqual([])
    expect(rememberWorkspaceReports([saved], [{ ...partial, reactDoctor: { ...doctor([], after), warning: 'Found no supported source files' } }])[0].reactDoctor).toBe(saved.reactDoctor)
  })

  it('retains skipped dependencies without hiding new findings in the same partial check', () => {
    const first = { ...project, outdated: outdated(before) }
    const skipped = { name: 'old', reason: 'Registry unavailable' }
    const empty = { ...project, outdated: { ...outdated(after, 'current'), findings: [], skipped: [skipped] } }
    const retained = rememberWorkspaceReports([first], [empty])
    expect(retained[0].outdated?.level).toBe('high')
    expect(retained[0].outdated?.findings).toEqual(first.outdated.findings)
    expect(newWorkspaceUpdates(retained, [{ ...project, outdated: outdated(later) }])).toEqual([])

    const added = { ...first.outdated.findings[0], name: 'new' }
    const partial = { ...project, outdated: { ...outdated(after), findings: [added], skipped: [skipped, { name: 'local-peer', reason: 'Local package' }] } }
    expect(newWorkspaceUpdates([first], [partial])).toHaveLength(1)
    const merged = rememberWorkspaceReports([first], [partial])
    expect(merged[0].outdated?.findings.map(item => item.name)).toEqual(['new', 'old'])
    const full = { ...project, outdated: { ...outdated(later), findings: [first.outdated.findings[0], added] } }
    expect(newWorkspaceUpdates(merged, [full])).toEqual([])
    expect(partial.outdated.findings).toEqual([added])

    const resolved = rememberWorkspaceReports(merged, [{ ...project, outdated: { ...outdated(later), findings: [added], skipped: [{ name: 'local-peer', reason: 'Local package' }] } }])
    expect(resolved[0].outdated?.findings).toEqual([added])
  })

  it('retains older and unknown refreshes but accepts a fresh successful resolution', () => {
    const current = { ...saved, audit: audit([finding], after) }
    expect(rememberWorkspaceReports([current], [{ ...project, audit: audit([], before) }])[0].audit).toBe(current.audit)
    expect(rememberWorkspaceReports([saved], [{ ...project, audit: audit([], after), reportState: { audit: { helperInstanceId: 'boot', revision: 2, validity: 'unknown' } } }])[0].audit).toBe(saved.audit)
    const clean = rememberWorkspaceReports([saved], [{ ...project, audit: audit([], after) }])
    expect(clean[0].audit?.findings).toEqual([])
    expect(newWorkspaceUpdates(clean, [{ ...project, audit: audit([finding], later) }])).toHaveLength(1)
  })

  it('baselines settings-only threshold changes and confirmation of cached reports', () => {
    const configured = rememberWorkspaceReports([{ ...project, outdated: outdated(before, 'moderate') }], [{ ...project, outdated: outdated(before) }])
    expect(newWorkspaceUpdates(configured, [{ ...project, outdated: outdated(after) }])).toEqual([])
    const unknown = { ...saved, reportState: { audit: { helperInstanceId: 'boot', revision: 1, validity: 'unknown' as const } } }
    const confirmed = { ...saved, reportState: { audit: { helperInstanceId: 'boot', revision: 2, validity: 'available' as const } } }
    expect(newWorkspaceUpdates([unknown], [confirmed])).toEqual([])
    expect(newWorkspaceUpdates(rememberWorkspaceReports([unknown], [confirmed]), [{ ...project, audit: audit([finding], after) }])).toEqual([])
  })

  it('drops absent projects, baselines added projects, and clears a changed remote origin', () => {
    expect(rememberWorkspaceReports([saved], [])).toEqual([])
    expect(rememberWorkspaceReports([], [saved])[0]).toBe(saved)
    expect(rememberWorkspaceReports([saved], [{ ...project, git: { origin: 'https://github.com/other/repo' } }])[0].remoteActivity).toBeUndefined()
    const changed = { ...project, git: { origin: 'https://gitlab.com/team/app' }, remoteActivity: { ...activity([], []), repository: 'https://gitlab.com/team/app' } }
    expect(rememberWorkspaceReports([saved], [changed])[0].remoteActivity).toBe(changed.remoteActivity)
  })
})
