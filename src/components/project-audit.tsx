import { ArrowUpCircle, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { auditFixDependency } from '@/lib/audit-fix'
import { isDeclaredWorkspaceMember } from '@/lib/workspace'
import type { AuditFinding, AuditFixRequest, AuditSeverity, PackageAudit, RepoProject } from '@/types'
import { useSettings } from '@/hooks/use-settings'
import './project-audit.css'

const severities: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']

function advisoryUrl(value?: string) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

interface Props {
  project: RepoProject
  helper: boolean
  demo: boolean
  busy: string
  onAction: (name: string, body?: unknown) => void
}

export function ProjectAudit({ project, helper, demo, busy, onAction }: Props) {
  const scanning = busy === `${project.id}:audit`
  const report = project.audit

  return <section className="audit-section" aria-label="Package vulnerability audit">
    <div className="maintenance-heading"><h3><ShieldCheck size={16} /> Vulnerabilities</h3><Button variant="outline" size="sm" disabled={!!busy || demo} onClick={() => onAction('audit')}>
      {scanning ? <LoaderCircle size={14} className="spinning" /> : <ShieldCheck size={14} />}{scanning ? 'Scanning…' : report ? 'Scan again' : 'Scan for vulnerabilities'}
    </Button></div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to audit your packages.' : helper ? `Runs ${project.packageManager} audit against ${isDeclaredWorkspaceMember(project) ? 'the shared workspace lockfile (all workspace packages)' : 'the lockfile'}, including development dependencies. Package names and versions are sent to the configured registry. Scanning does not change packages.` : 'Connect with the local helper to run package audits.'}</p>
    {report ? <AuditReport report={report} project={project} helper={helper} demo={demo} busy={busy} onAction={onAction} /> : <p className="maintenance-empty">Not scanned yet.</p>}
  </section>
}

function AuditReport({ report, project, helper, demo, busy, onAction }: Props & { report: PackageAudit }) {
  const { settings } = useSettings()
  const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0)
  const suppressed = report.findings.filter(finding => finding.suppression).length
  const findings = [...report.findings].sort((a, b) => Number(!!a.suppression) - Number(!!b.suppression))
  return <>
    <p className="audit-result" role="status">{total ? `${total} reported ${total === 1 ? 'vulnerability' : 'vulnerabilities'}` : suppressed ? 'No active vulnerabilities reported' : 'No known vulnerabilities reported'}<span>Last scan · {new Date(report.scannedAt).toLocaleString()} · {report.manager}</span></p>
    {!!suppressed && <p className="maintenance-hint">{suppressed} suppressed {suppressed === 1 ? 'finding' : 'findings'} · excluded from badges, alerts, and todos.</p>}
    {report.warnings?.map(warning => <p className="audit-warning" key={warning}>{warning}</p>)}
    <div className="audit-counts">{severities.map(severity => <span key={severity} className={`severity severity-${severity} audit-color-${settings.auditColors[severity]}`}><b>{report.counts[severity]}</b> {severity}</span>)}</div>
    {findings.some(finding => auditFixDependency(project, finding)) && <p className="maintenance-hint audit-fix-hint">Install compatible fix allows only minor or patch updates, pins exact versions, and disables lifecycle scripts. It rechecks the finding before installing and audits again afterward; some findings may need a manual major upgrade.</p>}
    {!!report.findings.length && <ul className="audit-findings">{findings.map(finding => <li className={finding.suppression ? 'audit-finding-suppressed' : undefined} key={JSON.stringify([finding.name, finding.severity, finding.title, finding.range, finding.url, !!finding.suppression])}>
      <div><strong>{finding.name}</strong><span className={`severity severity-${finding.severity} audit-color-${finding.suppression ? 'neutral' : settings.auditColors[finding.severity]}`}>{finding.suppression ? `Suppressed · ${finding.severity}` : finding.severity}</span></div>
      <p>{finding.title}</p>
      {finding.suppression && <p className="audit-suppression">Suppressed by <code>{finding.suppression.source}</code> · {finding.suppression.ids.join(', ')}{finding.suppression.reason && ` · ${finding.suppression.reason}`}</p>}
      <div className="finding-detail">{finding.range && <code>{finding.range}</code>}{finding.direct !== undefined && <span>{finding.direct ? 'Direct dependency' : 'Transitive dependency'}</span>}{finding.fixAvailable !== undefined && <span>{finding.fixAvailable ? 'Fix available' : 'No fix reported'}</span>}{advisoryUrl(finding.url) && <a href={advisoryUrl(finding.url)} target="_blank" rel="noreferrer">Advisory <ExternalLink size={11} /></a>}</div>
      <AuditFixAction finding={finding} project={project} helper={helper} demo={demo} busy={busy} onAction={onAction} />
    </li>)}</ul>}
    <p className="maintenance-hint">Saved result from the last successful scan. Scan again after dependency or ignore-file changes. Counts follow the package manager’s report, excluding matched suppressions. Summary counts without matching advisory details remain active.</p>
  </>
}

function AuditFixAction({ finding, project, helper, demo, busy, onAction }: Props & { finding: AuditFinding }) {
  if (finding.suppression || !finding.fixAvailable) return null
  const dependency = auditFixDependency(project, finding)
  if (!dependency) return <p className="audit-fix-unavailable">{finding.direct === false ? 'Update the parent dependency manually; no supported direct dependency target was identified.' : 'Review the advisory for a manual update; this dependency cannot be updated here.'}</p>
  const running = project.dev?.status === 'running' || project.dev?.status === 'starting'
  return <div className="audit-fix-action">
    <Button variant="outline" size="sm" disabled={!!busy || demo || !helper || running} aria-label={`Install compatible fix for ${dependency.name}`} onClick={() => onAction('fix-vulnerability', { name: finding.name, title: finding.title, range: finding.range, url: finding.url } satisfies AuditFixRequest)}>
      <ArrowUpCircle size={14} />Install compatible fix
    </Button>
    {dependency.name !== finding.name && <span>Updates <code>{dependency.name}</code> within its current major version.</span>}
    {running && <span>Stop the development server before installing a fix.</span>}
    {!helper && <span>Connect with the local helper to install a fix.</span>}
  </div>
}
