import { ArrowUpCircle, LoaderCircle, PackageSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatOutdatedScore, outdatedScoreExplanation } from '@/lib/outdated'
import { useSettings } from '@/hooks/use-settings'
import type { RepoProject } from '@/types'
import { DependencyUpdates } from '@/components/dependency-updates'

export function ProjectOutdated({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const { settings } = useSettings()
  const report = project.outdated
  const scanning = busy === `${project.id}:outdated`
  const updating = busy === `${project.id}:update-minor` || busy === `${project.id}:update-patches`
  const count = report?.findings.length ?? 0
  const skipped = report?.skipped ?? []

  return <section className="outdated-section" aria-label="Outdated packages">
    <div className="maintenance-heading"><h3><PackageSearch size={16} /> Outdated packages</h3><Button variant="outline" size="sm" disabled={!!busy || demo} onClick={() => onAction('outdated')}>
      {scanning ? <LoaderCircle size={14} className="spinning" /> : <PackageSearch size={14} />}{scanning ? 'Checking packages…' : report ? 'Scan outdated again' : 'Scan for outdated packages'}
    </Button></div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to check for outdated packages.' : helper ? 'Compares resolved versions of declared packages with the latest registry release, including development dependencies. Package names and versions are sent to the configured registry. Scanning does not change packages.' : 'Connect with the local helper to check for outdated packages.'}</p>
    {helper && !demo && <div className="package-update-actions">
      <div className="dev-actions">
        <Button variant="outline" size="sm" disabled={!!busy || !count} onClick={() => onAction('update-patches')}>
          {updating && busy.endsWith('update-patches') ? <LoaderCircle size={14} className="spinning" /> : <ArrowUpCircle size={14} />}Update patches
        </Button>
        <Button variant="outline" size="sm" disabled={!!busy || !count} onClick={() => onAction('update-minor')}>
          {updating && busy.endsWith('update-minor') ? <LoaderCircle size={14} className="spinning" /> : <ArrowUpCircle size={14} />}Update minor versions
        </Button>
      </div>
      <p className="maintenance-hint">Patches stay within the installed minor version. Minor updates include patches and stay within the installed major version. Updates install stable releases and pin updated packages to exact versions in package.json, updating the lockfile. Lifecycle scripts are skipped.{project.monorepo ? ' This workspace shares its lockfile with sibling packages.' : ''}</p>
      {updating && <p className="maintenance-hint" role="status">Checking compatible releases and updating packages…</p>}
    </div>}
    {project.packageUpdate && <div className="package-update-result">
      <p className="maintenance-hint">Last update · {new Date(project.packageUpdate.updatedAt).toLocaleString()} · {project.packageUpdate.packages.length} packages updated. Scan again to refresh outdated and vulnerability results.</p>
      {!!project.packageUpdate.packages.length && <ul>{project.packageUpdate.packages.map(item => <li key={item.name}><strong>{item.name}</strong> <code>{item.from}</code> → <code>{item.to}</code></li>)}</ul>}
      {!!project.packageUpdate.skipped.length && <details><summary>{project.packageUpdate.skipped.length} packages skipped</summary><ul>{project.packageUpdate.skipped.map((item, index) => <li key={`${item.name}:${index}`}>{item.name}: {item.reason}</li>)}</ul></details>}
    </div>}
    {report ? <>
      <div className="outdated-result" role="status" aria-label="Outdated package scan result">
        <div><span>{count ? `${count} outdated ${count === 1 ? 'package' : 'packages'}` : skipped.length ? 'No outdated packages found among checked packages' : 'All checked packages are up to date'}</span><span className={`outdated-score outdated-level-${report.level}`}>Update score <strong>{formatOutdatedScore(report.score)}</strong></span></div>
        <p>Last scan · {new Date(report.scannedAt).toLocaleString()} · {report.manager}</p>
      </div>
      <p className="maintenance-hint outdated-explanation">{outdatedScoreExplanation(settings)}</p>
      {!!count && <DependencyUpdates findings={report.findings} />}
      {!!skipped.length && <details className="outdated-skipped"><summary>{skipped.length} {skipped.length === 1 ? 'package was' : 'packages were'} not compared</summary><p>Skipped packages do not contribute to the score.</p><ul>{skipped.map((item, index) => <li key={`${item.name}:${index}`}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></details>}
      <p className="maintenance-hint">Result saved from the last successful scan. Check again after dependency changes.</p>
    </> : <p className="maintenance-empty">Outdated packages not scanned yet.</p>}
  </section>
}
