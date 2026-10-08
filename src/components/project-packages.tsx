import { useState } from 'react'
import { ExternalLink, LoaderCircle, Package, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectOutdated } from '@/components/project-outdated'
import { dependencyKindLabel, packageMatches } from '@/lib/packages'
import type { AuditSeverity, RepoProject } from '@/types'
import { useSettings } from '@/hooks/use-settings'

const severities: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']

function advisoryUrl(value?: string) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

export function PackageMatches({ project, query }: { project: RepoProject; query: string }) {
  const { settings } = useSettings()
  const matches = packageMatches(project, query)
  if (!matches.length) return null
  return <div className="package-matches" aria-label="Matching packages">
    {matches.slice(0, settings.packageMatchLimit).map(item => <div key={`${item.kind}:${item.name}`} title={`${dependencyKindLabel(item.kind)} · declared version`}><span>{item.name}</span><code>{item.version}</code></div>)}
    {matches.length > settings.packageMatchLimit && <span>+{matches.length - settings.packageMatchLimit} more in Packages</span>}
  </div>
}

export function ProjectPackages({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const { settings } = useSettings()
  const [query, setQuery] = useState('')
  const dependencies = project.dependencies ?? []
  const visible = query.trim() ? packageMatches(project, query) : dependencies
  const scanning = busy === `${project.id}:audit`
  const report = project.audit
  const total = report ? Object.values(report.counts).reduce((sum, count) => sum + count, 0) : 0

  return <div className="packages-panel">
    <section className="audit-section" aria-label="Package vulnerability audit">
      <div className="maintenance-heading"><h3><ShieldCheck size={16} /> Vulnerabilities</h3><Button variant="outline" size="sm" disabled={!!busy || demo} onClick={() => onAction('audit')}>
        {scanning ? <LoaderCircle size={14} className="spinning" /> : <ShieldCheck size={14} />}{scanning ? 'Scanning…' : report ? 'Scan again' : 'Scan for vulnerabilities'}
      </Button></div>
      <p className="maintenance-hint">{demo ? 'Connect a directory to audit your packages.' : helper ? `Runs ${project.packageManager} audit against ${project.monorepo ? 'the shared workspace lockfile (all workspace packages)' : 'the lockfile'}, including development dependencies. Package names and versions are sent to the configured registry. No fixes are applied.` : 'Connect with the local helper to run package audits.'}</p>
      {report ? <>
        <p className="audit-result" role="status">{total ? `${total} reported ${total === 1 ? 'vulnerability' : 'vulnerabilities'}` : 'No known vulnerabilities reported'}<span>Last scan · {new Date(report.scannedAt).toLocaleString()} · {report.manager}</span></p>
        <div className="audit-counts">{severities.map(severity => <span key={severity} className={`severity severity-${severity} audit-color-${settings.auditColors[severity]}`}><b>{report.counts[severity]}</b> {severity}</span>)}</div>
        {!!report.findings.length && <ul className="audit-findings">{report.findings.map((finding, index) => <li key={`${finding.name}:${index}`}>
          <div><strong>{finding.name}</strong><span className={`severity severity-${finding.severity} audit-color-${settings.auditColors[finding.severity]}`}>{finding.severity}</span></div>
          <p>{finding.title}</p>
          <div className="finding-detail">{finding.range && <code>{finding.range}</code>}{finding.direct !== undefined && <span>{finding.direct ? 'Direct dependency' : 'Transitive dependency'}</span>}{finding.fixAvailable !== undefined && <span>{finding.fixAvailable ? 'Fix available' : 'No fix reported'}</span>}{advisoryUrl(finding.url) && <a href={advisoryUrl(finding.url)} target="_blank" rel="noreferrer">Advisory <ExternalLink size={11} /></a>}</div>
        </li>)}</ul>}
        <p className="maintenance-hint">Saved result from the last successful scan. Scan again after dependency changes. Counts follow the package manager’s report.</p>
      </> : <p className="maintenance-empty">Not scanned yet.</p>}
    </section>
    <ProjectOutdated project={project} helper={helper} demo={demo} busy={busy} onAction={onAction} />
    <section aria-label="Declared packages">
      <div className="maintenance-heading"><h3><Package size={16} /> Packages <span className="muted-count">{dependencies.length}</span></h3></div>
      <p className="maintenance-hint">Versions are declared ranges from package.json, not installed versions. Includes runtime, development, peer, and optional dependencies. Search name@version to find compatible ranges, using * for wildcards.</p>
      {project.dependencies === undefined ? <p className="maintenance-empty">Resync your directory to load package details.</p> : dependencies.length ? <>
        <input className="package-filter" aria-label="Filter packages in project" placeholder="e.g. next, next@16.0.0, next@16.*.*…" value={query} onChange={event => setQuery(event.target.value)} />
        {visible.length ? <div className="dependency-table-wrap"><table className="dependency-table"><thead><tr><th>Package</th><th>Declared version</th><th>Type</th></tr></thead><tbody>{visible.map(item => <tr key={`${item.kind}:${item.name}`}><td>{item.name}</td><td><code>{item.version}</code></td><td>{dependencyKindLabel(item.kind)}</td></tr>)}</tbody></table></div> : <p className="maintenance-empty">No packages match this search.</p>}
      </> : <p className="maintenance-empty">No declared packages found.</p>}
    </section>
  </div>
}
