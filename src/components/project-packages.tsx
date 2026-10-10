import { useState } from 'react'
import { Package } from 'lucide-react'
import { dependencyKindLabel, packageMatches } from '@/lib/packages'
import type { RepoProject } from '@/types'
import { useSettings } from '@/hooks/use-settings'

export function PackageMatches({ project, query }: { project: RepoProject; query: string }) {
  const { settings } = useSettings()
  const matches = packageMatches(project, query)
  if (!matches.length) return null
  return <div className="package-matches" aria-label="Matching packages">
    {matches.slice(0, settings.packageMatchLimit).map(item => <div key={`${item.kind}:${item.name}`} title={`${dependencyKindLabel(item.kind)} · declared version`}><span>{item.name}</span><code>{item.version}</code></div>)}
    {matches.length > settings.packageMatchLimit && <span>+{matches.length - settings.packageMatchLimit} more in Packages</span>}
  </div>
}

export function ProjectPackages({ project }: { project: RepoProject }) {
  const [query, setQuery] = useState('')
  const dependencies = project.dependencies ?? []
  const visible = query.trim() ? packageMatches(project, query) : dependencies
  return <section aria-label="Declared packages">
    <div className="maintenance-heading"><h3><Package size={16} /> Packages <span className="muted-count">{dependencies.length}</span></h3></div>
    <p className="maintenance-hint">Versions are declared ranges from package.json, not installed versions. Includes runtime, development, peer, and optional dependencies. Search name@version to find compatible ranges, using * for wildcards.</p>
    {project.dependencies === undefined ? <p className="maintenance-empty">Resync your directory to load package details.</p> : dependencies.length ? <>
      <input className="package-filter" aria-label="Filter packages in project" placeholder="e.g. next, next@16.0.0, next@16.*.*…" value={query} onChange={event => setQuery(event.target.value)} />
      {visible.length ? <div className="dependency-table-wrap"><table className="dependency-table"><thead><tr><th>Package</th><th>Declared version</th><th>Type</th></tr></thead><tbody>{visible.map(item => <tr key={`${item.kind}:${item.name}`}><td>{item.name}</td><td><code>{item.version}</code></td><td>{dependencyKindLabel(item.kind)}</td></tr>)}</tbody></table></div> : <p className="maintenance-empty">No packages match this search.</p>}
    </> : <p className="maintenance-empty">No declared packages found.</p>}
  </section>
}
