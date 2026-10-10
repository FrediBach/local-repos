import type { RepoProject } from '../types'
import { criticalFindingKey } from './critical-vulnerabilities'

export interface ProjectTodo {
  id: string
  projectId: string
  kind: 'security' | 'outdated' | 'react-doctor'
  title: string
  description: string
  priority: 'critical' | 'high'
  tab: 'vulnerabilities' | 'updates' | 'react-doctor'
  scannedAt: string
  findingKeys: string[]
}

const counted = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`
export const projectTodoId = (projectId: string, kind: ProjectTodo['kind']) => JSON.stringify([projectId, kind])

/** Keep duplicate occurrences stable when scan output is reordered or lines move. */
function occurrenceKeys(keys: string[]): string[] {
  const counts = new Map<string, number>()
  return keys.sort().map(key => {
    const occurrence = (counts.get(key) ?? 0) + 1
    counts.set(key, occurrence)
    return JSON.stringify([key, occurrence])
  })
}

/** A project contributes at most three actionable groups, using configured scan levels. */
export function projectTodos(projects: RepoProject[]): ProjectTodo[] {
  const todos: ProjectTodo[] = []
  for (const project of projects) {
    const base = { projectId: project.id }
    if (project.audit) {
      const report = project.audit
      const findings = [...new Map(report.findings.filter(finding => !finding.suppression && (finding.severity === 'critical' || finding.severity === 'high'))
        .map(finding => [JSON.stringify([finding.severity, criticalFindingKey(finding)]), finding])).entries()]
      const critical = Math.max(report.counts.critical, findings.filter(([, finding]) => finding.severity === 'critical').length)
      const high = Math.max(report.counts.high, findings.filter(([, finding]) => finding.severity === 'high').length)
      if (critical || high) {
        const findingKeys = findings.map(([key]) => key)
        // Some managers only return counts. Numbered slots preserve dismissals
        // when the count falls, and expose newly added findings when it rises.
        for (const severity of ['critical', 'high'] as const) {
          const detailed = findings.filter(([, finding]) => finding.severity === severity).length
          for (let index = detailed; index < report.counts[severity]; index++) findingKeys.push(JSON.stringify(['count', severity, index - detailed]))
        }
        todos.push({ ...base, id: projectTodoId(project.id, 'security'), kind: 'security',
          title: critical ? 'Fix critical vulnerabilities' : 'Fix high-severity vulnerabilities',
          description: `${[critical && counted(critical, 'critical vulnerability', 'critical vulnerabilities'), high && counted(high, 'high-severity vulnerability', 'high-severity vulnerabilities')].filter(Boolean).join(' and ')}. Review affected packages and available fixes.`,
          priority: critical ? 'critical' : 'high', tab: 'vulnerabilities', scannedAt: report.scannedAt, findingKeys: findingKeys.sort() })
      }
    }

    const outdated = project.outdated
    if (outdated?.level === 'high' && outdated.findings.length) {
      todos.push({ ...base, id: projectTodoId(project.id, 'outdated'), kind: 'outdated',
        title: 'Update outdated dependencies',
        description: `${counted(outdated.findings.length, 'outdated dependency', 'outdated dependencies')} ${outdated.findings.length === 1 ? 'exceeds' : 'exceed'} your high-priority threshold. Review the available updates.`,
        priority: 'high', tab: 'updates', scannedAt: outdated.scannedAt,
        findingKeys: [...new Set(outdated.findings.map(finding => JSON.stringify([finding.name, finding.current, finding.latest, finding.change, finding.majorGap])))].sort() })
    }

    const doctor = project.reactDoctor
    const errors = doctor?.findings.filter(finding => finding.severity === 'error') ?? []
    if (doctor && errors.length) {
      todos.push({ ...base, id: projectTodoId(project.id, 'react-doctor'), kind: 'react-doctor',
        title: 'Fix React Doctor errors',
        description: `${counted(errors.length, 'error')} across ${counted(new Set(errors.map(finding => finding.filePath)).size, 'file')}. Review the diagnostics and suggested fixes.`,
        priority: 'high', tab: 'react-doctor', scannedAt: doctor.scannedAt,
        findingKeys: occurrenceKeys(errors.map(finding => JSON.stringify([finding.filePath, finding.plugin, finding.rule, finding.severity, finding.message]))) })
    }
  }
  return todos.sort((a, b) => Number(b.priority === 'critical') - Number(a.priority === 'critical'))
}
