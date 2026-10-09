import type { ComponentProps } from 'react'
import { CircleHelp, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import { ThemeControl } from './theme-control'
import { SettingsDialog } from './settings-dialog'
import { HostedNotice } from './hosted-notice'

interface Props {
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

export function WorkspaceTopbar({ page, stack, filter, hasFilters, hosted, online, connected, busy, onConnect, onHelp, backup }: Props) {
  const pageName = page === 'todos' ? 'Todos' : page === 'summary' ? 'Daily summary' : stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : hasFilters ? 'Filtered projects' : 'All projects')
  return <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><h1>{pageName}</h1></div><div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>
    <Button className="topbar-directory-button" variant={connected ? 'outline' : 'default'} size="sm" disabled={busy} onClick={onConnect}><FolderOpen size={16} />{connected ? 'Change directory' : 'Connect directory'}</Button>
    {hosted && <HostedNotice />}<ThemeControl /><div className="local-indicator"><span className={`status-dot ${online ? '' : 'neutral'}`} /><span className="local-label">{online ? 'All local. All yours.' : 'Offline · cached workspace'}</span><button className="workspace-info-button" aria-label="Workspace info" onClick={onHelp}><CircleHelp size={15} /></button><SettingsDialog backup={backup} /></div></div></header>
}
