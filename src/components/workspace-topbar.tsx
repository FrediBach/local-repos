import type { ComponentProps } from 'react'
import { CircleHelp } from 'lucide-react'
import { ThemeControl } from './theme-control'
import { SettingsDialog } from './settings-dialog'
import { HostedNotice } from './hosted-notice'

interface Props {
  page: 'projects' | 'summary'
  stack: string | null
  filter: 'all' | 'favorites' | 'running'
  hasFilters: boolean
  hosted: boolean
  online: boolean
  onHelp: () => void
  backup: ComponentProps<typeof SettingsDialog>['backup']
}

export function WorkspaceTopbar({ page, stack, filter, hasFilters, hosted, online, onHelp, backup }: Props) {
  const pageName = page === 'summary' ? 'Daily summary' : stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : hasFilters ? 'Filtered projects' : 'All projects')
  return <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><h1>{pageName}</h1></div><div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>{hosted && <HostedNotice />}<ThemeControl /><div className="local-indicator"><span className={`status-dot ${online ? '' : 'neutral'}`} /><span className="local-label">{online ? 'All local. All yours.' : 'Offline · cached workspace'}</span><button className="workspace-info-button" aria-label="Workspace info" onClick={onHelp}><CircleHelp size={15} /></button><SettingsDialog backup={backup} /></div></div></header>
}
