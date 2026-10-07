import { ArrowRight, LoaderCircle, PackageSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatOutdatedScore, OUTDATED_SCORE_EXPLANATION } from '@/lib/outdated'
import { dependencyKindLabel } from '@/lib/packages'
import type { OutdatedFinding, RepoProject } from '@/types'

function changeLabel(finding: OutdatedFinding) {
  if (finding.change === 'major') return `${finding.majorGap} major ${finding.majorGap === 1 ? 'version' : 'versions'} behind`
  return `${finding.change === 'prerelease' ? 'Prerelease' : finding.change === 'minor' ? 'Minor' : 'Patch'} update`
}

export function ProjectOutdated({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const report = project.outdated
  const scanning = busy === `${project.id}:outdated`
  const count = report?.findings.length ?? 0
  const skipped = report?.skipped ?? []

  return <section className="outdated-section" aria-label="Outdated packages">
    <div className="maintenance-heading"><h3><PackageSearch size={16} /> Outdated packages</h3><Button variant="outline" size="sm" disabled={!!busy || demo} onClick={() => onAction('outdated')}>
      {scanning ? <LoaderCircle size={14} className="spinning" /> : <PackageSearch size={14} />}{scanning ? 'Checking packages…' : report ? 'Scan outdated again' : 'Scan for outdated packages'}
    </Button></div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to check for outdated packages.' : helper ? 'Compares resolved versions of declared packages with the latest registry release, including development dependencies. Package names and versions are sent to the configured registry. No packages are changed.' : 'Connect with the local helper to check for outdated packages.'}</p>
    {report ? <>
      <div className="outdated-result" role="status" aria-label="Outdated package scan result">
        <div><span>{count ? `${count} outdated ${count === 1 ? 'package' : 'packages'}` : skipped.length ? 'No outdated packages found among checked packages' : 'All checked packages are up to date'}</span><span className={`outdated-score outdated-level-${report.level}`}>Update score <strong>{formatOutdatedScore(report.score)}</strong></span></div>
        <p>Last scan · {new Date(report.scannedAt).toLocaleString()} · {report.manager}</p>
      </div>
      <p className="maintenance-hint outdated-explanation">{OUTDATED_SCORE_EXPLANATION}</p>
      {!!count && <ul className="outdated-findings">{report.findings.map(finding => <li key={`${finding.kind ?? ''}:${finding.name}`}>
        <div className="outdated-finding-heading"><strong>{finding.name}</strong><span className="outdated-points">+{formatOutdatedScore(finding.score)} {finding.score === 1 ? 'point' : 'points'}</span></div>
        <div className="outdated-versions"><code>{finding.current}</code><ArrowRight size={12} aria-label="to" /><code>{finding.latest}</code><span>latest</span></div>
        <div className="finding-detail"><span>{changeLabel(finding)}</span>{finding.kind && <span>{dependencyKindLabel(finding.kind)}</span>}{finding.wanted && finding.wanted !== finding.latest && <span>Within declared range: <code>{finding.wanted}</code></span>}</div>
      </li>)}</ul>}
      {!!skipped.length && <details className="outdated-skipped"><summary>{skipped.length} {skipped.length === 1 ? 'package was' : 'packages were'} not compared</summary><p>Skipped packages do not contribute to the score.</p><ul>{skipped.map((item, index) => <li key={`${item.name}:${index}`}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></details>}
      <p className="maintenance-hint">Result saved from the last successful scan. Check again after dependency changes.</p>
    </> : <p className="maintenance-empty">Outdated packages not scanned yet.</p>}
  </section>
}
