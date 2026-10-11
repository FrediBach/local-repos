import type { AuditFinding, AuditSeverity, PackageAudit } from '../src/types'

export interface ParsedAuditFinding extends AuditFinding {
  advisories?: AuditFinding[]
  via?: string[]
}
export type ParsedAudit = { counts: PackageAudit['counts']; findings: ParsedAuditFinding[] }
type Suppression = NonNullable<AuditFinding['suppression']>
interface PendingSuppression { name: string; remaining: number; causes: Suppression[] }

const severities: AuditSeverity[] = ['info', 'low', 'moderate', 'high', 'critical']

export function suppressAuditFindings(report: ParsedAudit, rules: Map<string, Suppression>): Pick<PackageAudit, 'counts' | 'findings' | 'originalCounts'> {
  const match = (finding: AuditFinding) => finding.identifiers?.map(id => rules.get(id)).find(Boolean)
  if (!report.findings.some(finding => (finding.advisories ?? [finding]).some(match))) {
    return { counts: report.counts, findings: report.findings.map(({ advisories: _advisories, via: _via, ...finding }) => finding) }
  }
  const combine = (items: Suppression[]): Suppression => ({
    source: [...new Set(items.map(item => item.source))].join(', '),
    ids: [...new Set(items.flatMap(item => item.ids))],
    reason: [...new Set(items.flatMap(item => item.reason ? [item.reason] : []))].join('; ') || undefined,
  })
  const suppressed = new Map<string, Suppression>()
  const parents = new Map<string, PendingSuppression[]>()
  const queue: { name: string; suppression: Suppression }[] = []
  const enqueue = (name: string, causes: Suppression[]) => {
    const suppression = combine(causes)
    suppressed.set(name, suppression)
    queue.push({ name, suppression })
  }
  // Only prove a transitive package suppressed when every cause is known to be
  // suppressed. Missing references and cycles without a proven cause stay active.
  for (const finding of report.findings) {
    if (!finding.advisories) continue
    const own = finding.advisories.flatMap(item => match(item) ?? [])
    const via = finding.via ?? []
    if (own.length !== finding.advisories.length || (!own.length && !via.length)) continue
    if (!via.length) enqueue(finding.name, own)
    else {
      const parent = { name: finding.name, remaining: via.length, causes: own }
      for (const child of via) parents.set(child, [...parents.get(child) ?? [], parent])
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const child = queue[index]
    for (const parent of parents.get(child.name) ?? []) {
      parent.causes.push(child.suppression)
      parent.remaining -= 1
      if (!parent.remaining) enqueue(parent.name, parent.causes)
    }
  }

  const nodes = new Map(report.findings.filter(item => item.advisories).map(item => [item.name, item]))
  const activeSeverity = new Map<string, AuditSeverity>()
  const dependents = new Map<string, string[]>()
  const severityQueue: { name: string; severity: AuditSeverity }[] = []
  const raise = (name: string, severity: AuditSeverity) => {
    const current = activeSeverity.get(name)
    if (!current || severities.indexOf(severity) > severities.indexOf(current)) {
      activeSeverity.set(name, severity)
      severityQueue.push({ name, severity })
    }
  }
  for (const [name, finding] of nodes) {
    const advisories = finding.advisories
    if (suppressed.has(name) || !advisories) continue
    for (const item of advisories) if (!match(item)) raise(name, item.severity)
    if (!advisories.length && !finding.via?.length) raise(name, finding.severity)
    for (const child of finding.via ?? []) {
      if (!nodes.has(child)) raise(name, finding.severity)
      else dependents.set(child, [...dependents.get(child) ?? [], name])
    }
  }
  const propagate = () => {
    for (let index = 0; index < severityQueue.length; index++) {
      const child = severityQueue[index]
      for (const parent of dependents.get(child.name) ?? []) raise(parent, child.severity)
    }
    severityQueue.length = 0
  }
  propagate()
  // Unresolved cycles cannot establish suppression or a lower severity.
  for (const [name, finding] of nodes) if (!suppressed.has(name) && !activeSeverity.has(name)) raise(name, finding.severity)
  propagate()

  const counts = { ...report.counts }
  const findings: AuditFinding[] = []
  for (const { advisories, via: _via, ...finding } of report.findings) {
    const suppression = advisories ? suppressed.get(finding.name) : match(finding)
    if (suppression) {
      findings.push({ ...finding, suppression })
      counts[finding.severity] = Math.max(0, counts[finding.severity] - 1)
      continue
    }
    const ignored = advisories?.filter(item => match(item)) ?? []
    const active = advisories?.filter(item => !match(item)) ?? []
    const severity = advisories ? activeSeverity.get(finding.name) ?? finding.severity : finding.severity
    findings.push(ignored.length ? {
      ...finding, severity,
      title: active.map(item => item.title).join('; ') || 'Depends on a vulnerable package',
      url: active.find(item => item.url)?.url,
      identifiers: [...new Set(active.flatMap(item => item.identifiers ?? []))],
    } : { ...finding, severity })
    if (severity !== finding.severity) {
      counts[finding.severity] = Math.max(0, counts[finding.severity] - 1)
      counts[severity]++
    }
    for (const item of ignored) findings.push({ ...item, direct: finding.direct, fixAvailable: finding.fixAvailable, suppression: match(item) })
  }
  // Never hide a detailed active finding when a manager's summary uses a
  // different counting convention; unknown summary-only counts are preserved.
  for (const severity of severities) counts[severity] = Math.max(counts[severity], findings.filter(item => !item.suppression && item.severity === severity).length)
  const changed = findings.some(item => item.suppression)
  return {
    counts: changed ? counts : report.counts,
    findings: findings.sort((a, b) => Number(!!a.suppression) - Number(!!b.suppression) || severities.indexOf(b.severity) - severities.indexOf(a.severity) || a.name.localeCompare(b.name)),
    ...(changed ? { originalCounts: report.counts } : {}),
  }
}
