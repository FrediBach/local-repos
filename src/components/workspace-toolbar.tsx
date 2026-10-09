import { Folder, LoaderCircle, Monitor, Package, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react'
import { Button } from './ui/button'
import { relativeTime } from '@/lib/relative-time'
import { isReactProject } from '@/lib/react-doctor'
import type { Workspace } from '@/types'

interface Props {
  workspace?: Workspace
  projectCount: number
  busy: string
  onResync: () => void
  scanAllOutdated: () => void
  scanAllVulnerabilities: () => void
  scanAllReactDoctor: () => void
  captureAllPreviews: () => void
}

export function WorkspaceToolbar({ workspace, projectCount, busy, onResync, scanAllOutdated, scanAllVulnerabilities, scanAllReactDoctor, captureAllPreviews }: Props) {
  const isDemo = !workspace
  const workspacePath = workspace?.rootPath ?? (workspace ? workspace.rootName : '~/projects / demo workspace')
  return <section className="workspace-toolbar" aria-label="Workspace controls">
          <div className="workspace-details">
            <div className="workspace-directory"><Folder size={15} /><span className="workspace-path" title={workspacePath}>{workspacePath}</span>{isDemo && <span className="sample-badge">SAMPLE</span>}</div>
            <div className="workspace-status"><span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>{workspace && <><span aria-hidden="true">·</span><button onClick={onResync} disabled={!!busy} className="sync-button" title="Resync directory" aria-busy={busy === 'sync'}><RefreshCw size={13} className={busy === 'sync' ? 'spinning' : ''} /><span>{busy === 'sync' ? 'Syncing…' : `Synced ${relativeTime(workspace.syncedAt).toLowerCase()}`}</span></button></>}</div>
          </div>
          <WorkspaceActions workspace={workspace} projectCount={projectCount} busy={busy} scanAllOutdated={scanAllOutdated} scanAllVulnerabilities={scanAllVulnerabilities} scanAllReactDoctor={scanAllReactDoctor} captureAllPreviews={captureAllPreviews} />
        </section>
}

function WorkspaceActions({ workspace, projectCount, busy, scanAllOutdated, scanAllVulnerabilities, scanAllReactDoctor, captureAllPreviews }: Omit<Props, 'onResync'>) {
  const batchDisabled = !!busy || !workspace || !projectCount
  return <div className="workspace-actions">
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={scanAllOutdated} aria-busy={busy === 'batch-outdated'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan outdated packages' : `Check outdated packages in all ${projectCount} projects, including those hidden by filters. Contacts their configured registries.`}>{busy === 'batch-outdated' ? <LoaderCircle size={16} className="spinning" /> : <Package size={16} />}Scan outdated packages</Button>
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={scanAllVulnerabilities} aria-busy={busy === 'batch-audit'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan vulnerabilities' : `Audit all ${projectCount} projects, including those hidden by filters. Package names and versions are sent to their configured registries.`}>{busy === 'batch-audit' ? <LoaderCircle size={16} className="spinning" /> : <ShieldCheck size={16} />}Scan vulnerabilities</Button>
            <ReactDoctorScanButton workspace={workspace} busy={busy} disabled={batchDisabled} onScan={scanAllReactDoctor} />
            <Button variant="outline" size="sm" disabled={batchDisabled} onClick={captureAllPreviews} aria-busy={busy === 'batch-capture'} title={workspace?.mode === 'browser' ? 'Connect the local helper to capture previews' : `Capture previews for all ${projectCount} projects`}>{busy === 'batch-capture' ? <LoaderCircle size={16} className="spinning" /> : <Monitor size={16} />}Capture previews</Button>
          </div>
}

function ReactDoctorScanButton({ workspace, busy, disabled, onScan }: { workspace?: Workspace; busy: string; disabled: boolean; onScan: () => void }) {
  const projectCount = workspace?.projects.filter(isReactProject).length ?? 0
  const scanning = busy === 'batch-react-doctor'
  const scope = `${projectCount} React ${projectCount === 1 ? 'project' : 'projects'}`
  const title = !projectCount ? 'No React projects found in this workspace' : workspace?.mode === 'browser' ? 'Connect the local helper to run React Doctor' : `Run React Doctor on all ${scope}, including those hidden by filters. Diagnostic details are sent to React Doctor to calculate scores.`
  return <Button variant="outline" size="sm" disabled={disabled || !projectCount} onClick={onScan} aria-busy={scanning} title={title}>
    {scanning ? <LoaderCircle size={16} className="spinning" /> : <Stethoscope size={16} />}Scan React projects
  </Button>
}
