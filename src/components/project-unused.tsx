import { ExternalLink, LoaderCircle, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dependencyKindLabel } from '@/lib/packages'
import { isDeclaredWorkspaceMember } from '@/lib/workspace'
import type { PackageUnused, RepoProject } from '@/types'

export function ProjectUnused({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const report = project.unused
  const scanning = busy === `${project.id}:unused`

  return <section className="unused-section" aria-label="Unused packages">
    <div className="maintenance-heading"><h3><Scissors size={16} /> Unused packages</h3><Button variant="outline" size="sm" disabled={!!busy || demo || project.hasPackageJson === false} aria-busy={scanning} onClick={() => onAction('unused')}>
      {scanning ? <LoaderCircle size={14} className="spinning" /> : <Scissors size={14} />}{scanning ? 'Scanning unused packages…' : report ? 'Scan unused again' : 'Scan for unused packages'}
    </Button></div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to find unused packages.' : project.hasPackageJson === false ? 'This project has no package.json to scan.' : helper ? 'Knip analyzes source files and tooling to find unused runtime and development dependencies. Uses your project’s Knip configuration. No packages are removed.' : 'Connect with the local helper to scan for unused packages.'} <a href="https://knip.dev/" target="_blank" rel="noreferrer">About Knip <ExternalLink size={11} /></a></p>
    {helper && !demo && project.hasPackageJson !== false && <p className="maintenance-hint">{isDeclaredWorkspaceMember(project) ? 'Analyzes the workspace and shows findings from this project’s package.json. ' : ''}Knip may load project configuration code. Scan projects you trust, with their dependencies installed.</p>}
    {report ? <UnusedPackageReport report={report} /> : <p className="maintenance-empty">Unused packages not scanned yet.</p>}
  </section>
}

function UnusedPackageReport({ report }: { report: PackageUnused }) {
  const count = report.findings.length
  return <>
    <p className="audit-result" role="status" aria-label="Unused package scan result">{count ? `${count} potentially unused ${count === 1 ? 'package' : 'packages'}` : 'No unused packages reported'}<span>Last scan · {new Date(report.scannedAt).toLocaleString()} · Knip {report.knipVersion}</span></p>
    {!!count && <div className="dependency-table-wrap" role="region" aria-label="Unused package findings" tabIndex={0}><table className="dependency-table"><caption className="sr-only">Potentially unused packages reported by Knip</caption><thead><tr><th>Package</th><th>Declared version</th><th>Type</th><th>Location</th></tr></thead><tbody>{report.findings.map(item => <tr key={`${item.kind}:${item.name}`}><td>{item.name}</td><td><code>{item.version}</code></td><td>{dependencyKindLabel(item.kind)}</td><td><code>package.json{item.line ? `:${item.line}` : ''}</code></td></tr>)}</tbody></table></div>}
    {report.warning && <details className="unused-notes"><summary>Knip scan notes</summary><pre>{report.warning}</pre></details>}
    <p className="maintenance-hint">Saved result from the last successful scan. Review findings before removing packages; custom entry points and dynamic imports may need Knip configuration. Peer and optional dependencies are outside this report. Scan again after source or dependency changes.</p>
  </>
}
