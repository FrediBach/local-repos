import { GlobalCommitHeatmap } from './global-commit-heatmap'
import type { GlobalCommitActivity } from '@/lib/commit-activity'
import type { ComponentProps, Ref } from 'react'
import { CircleHelp, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import { ThemeControl } from './theme-control'
import { SettingsDialog } from './settings-dialog'
import { HostedNotice } from './hosted-notice'

interface Props {
  activity?: GlobalCommitActivity
  settingsTriggerRef?: Ref<HTMLButtonElement>
  page: 'projects' | 'summary' | 'todos'
  stack: string | null
  filter: 'all' | 'favorites' | 'running'
  hasFilters: boolean
  hosted: boolean
  online: boolean
  connected: boolean
  busy: boolean
  onConnect: () => void
  onHelp: () => void
  backup: ComponentProps<typeof SettingsDialog>['backup']
}

export function WorkspaceTopbar({ activity, settingsTriggerRef, page, stack, filter, hasFilters, hosted, online, connected, busy, onConnect, onHelp, backup }: Props) {
  const pageName = page === 'todos' ? 'Todos' : page === 'summary' ? 'Daily summary' : stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : hasFilters ? 'Filtered projects' : 'All projects')
  const statusLabel = online ? 'All local. All yours.' : 'Offline · cached workspace'
  return <header className="topbar">
    <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><h1>{pageName}</h1></div>
    <div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>
      <div className={`local-indicator ${online ? '' : 'is-offline'}`} role="status" title={statusLabel}>
        <span className="sr-only">{statusLabel}</span>
        <span className={`status-dot ${online ? '' : 'neutral'}`} aria-hidden="true" />
        <span className="local-label" aria-hidden="true">{statusLabel}</span>
        <span className="local-label-compact" aria-hidden="true">{online ? 'Local' : 'Offline'}</span>
      </div>
      {activity && <GlobalCommitHeatmap activity={activity} />}
      <Button className="topbar-directory-button" variant={connected ? 'outline' : 'default'} size="sm" disabled={busy} onClick={onConnect}><FolderOpen size={16} aria-hidden="true" />{connected ? 'Change directory' : 'Connect directory'}</Button>
      {hosted && <HostedNotice />}
      <div className="topbar-utilities" role="group" aria-label="Workspace controls">
        <ThemeControl />
        <span className="topbar-utility-divider" aria-hidden="true" />
        <button type="button" className="workspace-info-button" aria-label="Workspace info" title="Workspace info" onClick={onHelp}><CircleHelp size={17} aria-hidden="true" /></button>
        <SettingsDialog backup={backup} triggerRef={settingsTriggerRef} />
      </div>
    </div>
  </header>
}
