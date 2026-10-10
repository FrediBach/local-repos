import type { AuditFinding, PackageAudit } from '../types'

export interface CriticalVulnerabilityAlert {
  projectId: string
  projectName: string
  findings: AuditFinding[]
  additionalCount: number
}

// Ranges, fix availability, timestamps and report order can change without a
// new advisory. npm combines advisory titles, so normalize their order as well.
export function criticalFindingKey(finding: AuditFinding): string {
  const titles = finding.title.split('; ').map(title => title.trim().toLowerCase()).sort()
  return JSON.stringify([finding.name, finding.url ?? '', titles])
}

export function newCriticalVulnerabilities(previous: PackageAudit | undefined, next: PackageAudit) {
  const known = new Set(previous?.findings.filter(finding => !finding.suppression && finding.severity === 'critical').map(criticalFindingKey))
  const unique = new Map(next.findings.filter(finding => !finding.suppression && finding.severity === 'critical').map(finding => [criticalFindingKey(finding), finding]))
  const findings = [...unique].filter(([key]) => !known.has(key)).map(([, finding]) => finding)
  // Some managers supply summary counts without complete advisory details.
  const additionalCount = Math.max(0, next.counts.critical - (previous?.counts.critical ?? 0) - findings.length)
  return { findings, additionalCount }
}

export function mergeCriticalAlerts(current: CriticalVulnerabilityAlert[], incoming: CriticalVulnerabilityAlert): CriticalVulnerabilityAlert[] {
  const previous = current.find(alert => alert.projectId === incoming.projectId)
  if (!previous) return [...current, incoming]
  const findings = [...new Map([...previous.findings, ...incoming.findings].map(finding => [criticalFindingKey(finding), finding])).values()]
  return current.map(alert => alert === previous ? { ...incoming, findings, additionalCount: previous.additionalCount + incoming.additionalCount } : alert)
}
