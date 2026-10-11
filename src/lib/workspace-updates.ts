import type { AuditFinding, AuditSeverity, PackageAudit, RepoProject } from '../types'
import { criticalFindingKey } from './critical-vulnerabilities'
import { projectTodos } from './project-todos'
import { remoteRepository } from './remote-activity'
import { packageWorkspaceId } from './workspace'

export interface WorkspaceUpdate {
  key: string
  projectId: string
  scope: string
  kind: 'security' | 'warning' | 'activity'
  category: 'vulnerability' | 'issue' | 'pull-request' | 'dependency' | 'react-doctor'
}

const watchedReports = ['audit', 'outdated', 'reactDoctor', 'remoteActivity'] as const
type WatchedReport = typeof watchedReports[number]
const severities: AuditSeverity[] = ['info', 'low', 'moderate', 'high', 'critical']
const severityRank = (severity: AuditSeverity) => severities.indexOf(severity)
const reportTime = (report: { scannedAt: string } | undefined) => report ? Date.parse(report.scannedAt) : Number.NaN
const isIncompleteDoctor = (project: RepoProject) => project.reactDoctor?.label === 'Incomplete scan'
  || !!project.reactDoctor?.warning?.includes('no supported source files')

function usableReport(project: RepoProject, kind: WatchedReport): boolean {
  const state = project.reportState?.[kind]
  return !!project[kind] && Number.isFinite(reportTime(project[kind])) && (!state || state.validity === 'available')
    && (kind !== 'reactDoctor' || !isIncompleteDoctor(project))
    && (kind !== 'remoteActivity' || project.remoteActivity?.repository === remoteRepository(project)?.url)
}

function freshReport(previous: RepoProject, next: RepoProject, kind: WatchedReport): boolean {
  return usableReport(next, kind) && (!Number.isFinite(reportTime(previous[kind])) || reportTime(next[kind]) > reportTime(previous[kind]))
}

/** Missing, stale, or incomplete refreshes cannot establish that findings resolved. */
export function rememberWorkspaceReports(previous: RepoProject[], next: RepoProject[]): RepoProject[] {
  const known = new Map(previous.map(project => [project.id, project]))
  return next.map(project => {
    const old = known.get(project.id)
    // Newly connected or newly visible projects establish their own baseline.
    if (!old) return project
    const remembered = { ...project, reportState: { ...project.reportState } }
    for (const kind of watchedReports) {
      if (kind === 'remoteActivity' && remoteRepository(old)?.url !== remoteRepository(project)?.url) {
        if (!usableReport(project, kind)) delete remembered.remoteActivity
        continue
      }
      if (usableReport(project, kind) && (!Number.isFinite(reportTime(old[kind])) || reportTime(project[kind]) >= reportTime(old[kind]))) {
        if (kind === 'outdated' && project.outdated && old.outdated) {
          const skipped = new Set(project.outdated.skipped?.map(item => item.name))
          const checked = new Set(project.outdated.findings.map(item => item.name))
          const retained = old.outdated.findings.filter(item => skipped.has(item.name) && !checked.has(item.name))
          if (retained.length) {
            // This comparison-only snapshot remembers unresolved skipped packages;
            // the displayed report remains the helper's actual partial result.
            remembered.outdated = { ...project.outdated, findings: [...project.outdated.findings, ...retained],
              level: old.outdated.level === 'high' ? 'high' : project.outdated.level }
          }
        }
        continue
      }
      Object.assign(remembered, { [kind]: old[kind] })
      const state = old.reportState?.[kind]
      if (state) remembered.reportState[kind] = state
      else delete remembered.reportState[kind]
    }
    if (!Object.keys(remembered.reportState).length) delete (remembered as RepoProject).reportState
    return remembered
  })
}

function auditFindings(report: PackageAudit | undefined): Map<string, AuditFinding> {
  const findings = new Map<string, AuditFinding>()
  for (const finding of report?.findings ?? []) {
    if (finding.suppression) continue
    const key = criticalFindingKey(finding)
    const known = findings.get(key)
    if (!known || severityRank(finding.severity) > severityRank(known.severity)) findings.set(key, finding)
  }
  return findings
}

/** Compare fresh successful reports, independently of transient notices and UI filters. */
export function newWorkspaceUpdates(previous: RepoProject[], next: RepoProject[]): WorkspaceUpdate[] {
  const knownProjects = new Map(previous.map(project => [project.id, project]))
  const audits = new Map<string, PackageAudit>()
  const repositories = new Map<string, NonNullable<RepoProject['remoteActivity']>>()
  for (const project of previous) {
    const group = packageWorkspaceId(project)
    if (project.audit && Number.isFinite(reportTime(project.audit)) && (!audits.has(group) || reportTime(project.audit) > reportTime(audits.get(group)))) audits.set(group, project.audit)
    const activity = project.remoteActivity
    if (activity && Number.isFinite(reportTime(activity)) && activity.repository === remoteRepository(project)?.url
      && (!repositories.has(activity.repository) || reportTime(activity) > reportTime(repositories.get(activity.repository)))) {
      repositories.set(activity.repository, activity)
    }
  }

  const updates = new Map<string, WorkspaceUpdate>()
  const add = (projectId: string, category: WorkspaceUpdate['category'], kind: WorkspaceUpdate['kind'], scope: string, identity: string) => {
    const key = JSON.stringify([category, scope, identity])
    const known = updates.get(key)
    // A shared report can occur on several packages; keep the strongest signal.
    if (!known || known.kind !== 'security') updates.set(key, { key, projectId, scope, kind, category })
  }

  for (const project of next) {
    const old = knownProjects.get(project.id)
    if (!old) continue
    const group = packageWorkspaceId(project)
    const audit = project.audit
    const previousAudit = audits.get(group)
    if (audit && freshReport(old, project, 'audit') && (!previousAudit || reportTime(audit) > reportTime(previousAudit))) {
      const known = auditFindings(previousAudit)
      const findings = auditFindings(audit)
      for (const [identity, finding] of findings) {
        const oldFinding = known.get(identity)
        if (oldFinding && severityRank(finding.severity) <= severityRank(oldFinding.severity)) continue
        add(project.id, 'vulnerability', severityRank(finding.severity) >= severityRank('high') ? 'security' : 'warning', group, identity)
      }
      for (const severity of severities) {
        // Detailed findings explain count changes, including severity downgrades.
        const newDetails = [...findings].filter(([identity, finding]) => finding.severity === severity && known.get(identity)?.severity !== severity).length
        const additional = Math.max(0, audit.counts[severity] - (previousAudit?.counts[severity] ?? 0) - newDetails)
        for (let index = audit.counts[severity] - additional; index < audit.counts[severity]; index++) {
          add(project.id, 'vulnerability', severityRank(severity) >= severityRank('high') ? 'security' : 'warning', group, JSON.stringify(['count', severity, index]))
        }
      }
    }

    const activity = project.remoteActivity
    const previousActivity = activity && repositories.get(activity.repository)
    if (activity && previousActivity && remoteRepository(old)?.url === remoteRepository(project)?.url
      && usableReport(project, 'remoteActivity') && reportTime(activity) > reportTime(previousActivity)) {
      for (const [collection, category] of [['issues', 'issue'], ['pullRequests', 'pull-request']] as const) {
        const known = new Set(previousActivity[collection])
        for (const id of activity[collection]) if (!known.has(id)) add(project.id, category, 'activity', activity.repository, String(id))
      }
    }

    const oldTodos = new Map(projectTodos([old]).map(todo => [todo.kind, new Set(todo.findingKeys)]))
    for (const todo of projectTodos([project])) {
      if (todo.kind === 'security') continue
      const report = todo.kind === 'outdated' ? 'outdated' : 'reactDoctor'
      if (!freshReport(old, project, report)) continue
      for (const key of todo.findingKeys) {
        if (!oldTodos.get(todo.kind)?.has(key)) add(project.id, todo.kind === 'outdated' ? 'dependency' : 'react-doctor', 'activity', project.id, key)
      }
    }
  }
  return [...updates.values()]
}
