import { useRef, type ReactNode } from 'react'
import { remoteActivityProjects } from '@/lib/remote-activity'
import { ChevronDown, Folder, Gauge, GitPullRequest, ListChecks, LoaderCircle, Monitor, Package, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { WorkspaceReportNote } from './workspace-report-note'
import { relativeTime } from '@/lib/relative-time'
import { isReactProject } from '@/lib/react-doctor'
import { isLighthouseProject } from '@/lib/lighthouse'
import type { Workspace } from '@/types'

interface Props {
  workspace?: Workspace
  projectCount: number
  busy: string
  watcherStatus?: ReactNode
  onResync: () => void
  scanAllRemoteActivity: () => void
  scanAllOutdated: () => void
  scanAllVulnerabilities: () => void
  scanAllReactDoctor: () => void
  scanAllLighthouse: () => void
  captureAllPreviews: () => void
}

export function WorkspaceToolbar({ workspace, projectCount, busy, watcherStatus, onResync, ...actions }: Props) {
  const workspacePath = workspace?.rootPath ?? (workspace ? workspace.rootName : '~/projects / demo workspace')
  return <section className="workspace-toolbar" aria-label="Workspace controls">
    <div className="workspace-heading">
      <div className="workspace-directory"><Folder size={15} aria-hidden="true" /><span className="workspace-path" title={workspacePath}>{workspacePath}</span>{!workspace && <span className="sample-badge">SAMPLE</span>}</div>
      <WorkspaceActions workspace={workspace} projectCount={projectCount} busy={busy} {...actions} />
    </div>
    <div className="workspace-status">
      <span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
      {workspace && <><span className="workspace-status-divider" aria-hidden="true">·</span><button onClick={onResync} disabled={!!busy} className="sync-button" title="Resync directory" aria-busy={busy === 'sync'}><RefreshCw size={13} aria-hidden="true" className={busy === 'sync' ? 'spinning' : ''} /><span>{busy === 'sync' ? 'Syncing…' : `Synced ${relativeTime(workspace.syncedAt).toLowerCase()}`}</span></button></>}
      {watcherStatus && <div className="workspace-watcher">{watcherStatus}</div>}
      <WorkspaceReportNote workspace={workspace} compact />
    </div>
  </section>
}

function WorkspaceActions({ workspace, projectCount, busy, scanAllRemoteActivity, scanAllOutdated, scanAllVulnerabilities, scanAllReactDoctor, scanAllLighthouse, captureAllPreviews }: Omit<Props, 'onResync' | 'watcherStatus'>) {
  const actionsRef = useRef<HTMLDivElement>(null)
  const batchDisabled = !!busy || !workspace || !projectCount
  const reactCount = workspace?.projects.filter(isReactProject).length ?? 0
  const frontendCount = workspace?.projects.filter(isLighthouseProject).length ?? 0
  const checks = [
    { label: 'Check issues & PRs', description: 'Public GitHub & GitLab repositories', icon: GitPullRequest, action: scanAllRemoteActivity, key: 'batch-remote-activity', unavailable: !remoteActivityProjects(workspace?.projects ?? []).length,
      title: 'Check public GitHub and GitLab issues and pull requests for all repositories. Requires the local helper.' },
    { label: 'Scan outdated packages', description: 'Available dependency updates', icon: Package, action: scanAllOutdated, key: 'batch-outdated',
      title: workspace?.mode === 'browser' ? 'Connect the local helper to scan outdated packages' : `Check outdated packages in all ${projectCount} projects, including those hidden by filters. Contacts their configured registries.` },
    { label: 'Scan vulnerabilities', description: 'Dependency security advisories', icon: ShieldCheck, action: scanAllVulnerabilities, key: 'batch-audit',
      title: workspace?.mode === 'browser' ? 'Connect the local helper to scan vulnerabilities' : `Audit all ${projectCount} projects, including those hidden by filters. Package names and versions are sent to their configured registries.` },
    { label: 'Scan React projects', description: `${reactCount} React ${reactCount === 1 ? 'project' : 'projects'} · React Doctor`, icon: Stethoscope, action: scanAllReactDoctor, key: 'batch-react-doctor', unavailable: !reactCount,
      title: !reactCount ? 'No React projects found in this workspace' : workspace?.mode === 'browser' ? 'Connect the local helper to run React Doctor' : `Run React Doctor on all ${reactCount} React ${reactCount === 1 ? 'project' : 'projects'}, including those hidden by filters. Diagnostic details are sent to React Doctor to calculate scores.` },
    { label: 'Scan frontends with Lighthouse', description: `${frontendCount} frontend ${frontendCount === 1 ? 'project' : 'projects'} · Performance & accessibility`, icon: Gauge, action: scanAllLighthouse, key: 'batch-lighthouse', unavailable: !frontendCount,
      title: !frontendCount ? 'No testable frontend projects found in this workspace' : workspace?.mode === 'browser' ? 'Connect the local helper to run Lighthouse' : `Run Lighthouse on all ${frontendCount} frontend ${frontendCount === 1 ? 'project' : 'projects'}, including those hidden by filters. Loads each frontend in Chromium and starts local apps when needed.` },
  ]
  const checking = checks.some(check => check.key === busy)
  return <div className="workspace-actions" role="group" aria-label="Workspace actions" tabIndex={-1} ref={actionsRef}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={batchDisabled}><Button variant="outline" size="sm" disabled={batchDisabled} aria-label="Run checks" aria-busy={checking}>
        {checking ? <LoaderCircle size={16} className="spinning" aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}{checking ? 'Checking…' : 'Run checks'}<ChevronDown size={14} aria-hidden="true" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-checks-menu" align="end" aria-label="Workspace checks" aria-describedby="workspace-checks-scope" onCloseAutoFocus={event => {
        if (busy) { event.preventDefault(); actionsRef.current?.focus({ preventScroll: true }) }
      }}>
        <p id="workspace-checks-scope" className="workspace-checks-scope">All {projectCount} projects, including those hidden by filters.{workspace?.mode === 'browser' && ' Connect the local helper to run checks.'}</p>
        <DropdownMenuSeparator />
        {checks.map(({ label, description, icon: Icon, action, key, unavailable, title }) => <DropdownMenuItem key={key} onSelect={action} disabled={batchDisabled || unavailable} aria-label={label} aria-busy={busy === key} title={title}>
          <Icon size={16} aria-hidden="true" /><span className="workspace-check-copy"><span>{label}</span><small>{description}</small></span>
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="outline" size="sm" disabled={batchDisabled} onClick={captureAllPreviews} aria-busy={busy === 'batch-capture'} title={workspace?.mode === 'browser' ? 'Connect the local helper to capture previews' : `Capture previews for all ${projectCount} projects`}>
      {busy === 'batch-capture' ? <LoaderCircle size={16} className="spinning" aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}Capture previews
    </Button>
  </div>
}
