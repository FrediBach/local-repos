import { ShieldAlert } from 'lucide-react'
import type { AuditSeverity, RepoProject } from '@/types'

const severities: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']

export function ProjectAuditBadge({ project, onClick }: { project: RepoProject; onClick: () => void }) {
  const report = project.audit
  if (!report) return null
  const severity = severities.find(level => report.counts[level] > 0)
  if (!severity) return null

  const total = severities.reduce((sum, level) => sum + report.counts[level], 0)
  const label = `${project.name}: ${total} ${total === 1 ? 'vulnerability' : 'vulnerabilities'}, highest severity ${severity}. View audit details`
  const breakdown = severities.filter(level => report.counts[level] > 0).map(level => `${report.counts[level]} ${level}`).join(' · ')

  return <button
    type="button"
    className={`project-audit-badge audit-severity-${severity}`}
    aria-label={label}
    title={`${label}\n${breakdown}\nLast scan: ${new Date(report.scannedAt).toLocaleString()}`}
    onClick={onClick}
  ><ShieldAlert size={15} aria-hidden="true" /><span aria-hidden="true">{total}</span></button>
}
