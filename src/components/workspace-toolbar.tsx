import { Folder, FolderOpen, LoaderCircle, Monitor, Package, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from './ui/button'
import { relativeTime } from '@/lib/relative-time'
import type { Workspace } from '@/types'

interface Props {
  workspace?: Workspace
  projectCount: number
  busy: string
  onResync: () => void
  onConnect: () => void
  scanAllOutdated: () => void
  scanAllVulnerabilities: () => void
  captureAllPreviews: () => void
}

export function WorkspaceToolbar({ workspace, projectCount, busy, onResync, onConnect, scanAllOutdated, scanAllVulnerabilities, captureAllPreviews }: Props) {
  const isDemo = !workspace
  const workspacePath = workspace?.rootPath ?? (workspace ? workspace.rootName : '~/projects / demo workspace')
  return <section className="workspace-toolbar" aria-label="Workspace controls">
          <div className="workspace-details">
            <div className="workspace-directory"><Folder size={15} /><span className="workspace-path" title={workspacePath}>{workspacePath}</span>{isDemo && <span className="sample-badge">SAMPLE</span>}</div>
            <div className="workspace-status"><span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>{workspace && <><span aria-hidden="true">·</span><button onClick={onResync} disabled={!!busy} className="sync-button" title="Resync directory" aria-busy={busy === 'sync'}><RefreshCw size={13} className={busy === 'sync' ? 'spinning' : ''} /><span>{busy === 'sync' ? 'Syncing…' : `Synced ${relativeTime(workspace.syncedAt).toLowerCase()}`}</span></button></>}</div>
          </div>
          <WorkspaceActions workspace={workspace} projectCount={projectCount} busy={busy} scanAllOutdated={scanAllOutdated} scanAllVulnerabilities={scanAllVulnerabilities} captureAllPreviews={captureAllPreviews} onConnect={onConnect} />
        </section>
}

function WorkspaceActions({ workspace, projectCount, busy, onConnect, scanAllOutdated, scanAllVulnerabilities, captureAllPreviews }: Omit<Props, 'onResync'>) {
  const batchDisabled = !!busy || !workspace || !projectCount
  return <div className="workspace-actions">
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={scanAllOutdated} aria-busy={busy === 'batch-outdated'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan outdated packages' : `Check outdated packages in all ${projectCount} projects, including those hidden by filters. Contacts their configured registries.`}>{busy === 'batch-outdated' ? <LoaderCircle size={16} className="spinning" /> : <Package size={16} />}Scan outdated packages</Button>
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={scanAllVulnerabilities} aria-busy={busy === 'batch-audit'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan vulnerabilities' : `Audit all ${projectCount} projects, including those hidden by filters. Package names and versions are sent to their configured registries.`}>{busy === 'batch-audit' ? <LoaderCircle size={16} className="spinning" /> : <ShieldCheck size={16} />}Scan vulnerabilities</Button>
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={captureAllPreviews} aria-busy={busy === 'batch-capture'} title={workspace?.mode === 'browser' ? 'Connect the local helper to capture previews' : `Capture previews for all ${projectCount} projects`}>{busy === 'batch-capture' ? <LoaderCircle size={16} className="spinning" /> : <Monitor size={16} />}Capture previews</Button>
            <Button variant={workspace ? 'outline' : 'default'} size="sm" disabled={!!busy} onClick={onConnect}><FolderOpen size={16} />{workspace ? 'Change directory' : 'Connect directory'}</Button>
          </div>
}
