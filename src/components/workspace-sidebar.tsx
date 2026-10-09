import { ArrowUpRight, CalendarDays, ChevronDown, CircleHelp, Download, FolderOpen, LayoutGrid, ListTodo, Play, Star } from 'lucide-react'
import { Logo } from './brand-logo'
import type { ProjectFilters } from '@/lib/project-filters'
import type { RepoProject, Workspace } from '@/types'

interface NavigationProps {
  page: 'projects' | 'summary' | 'todos'
  filter: 'all' | 'favorites' | 'running'
  filters: ProjectFilters
  hasFilters: boolean
  projectCount: number
  favoriteCount: number
  running: number
  navigate: (filter: 'all' | 'favorites' | 'running') => void
  onSummary: () => void
  onTodos: () => void
  todoCount: number
}

interface Props extends Omit<NavigationProps, 'projectCount'> {
  workspace?: Workspace
  projects: RepoProject[]
  stacks: string[]
  busy: boolean
  toggleTechnology: (technology: string) => void
  onConnect: () => void
  onHelp: () => void
  onInstall?: () => Promise<void>
}

export function WorkspaceSidebar({ workspace, projects, stacks, busy, page, filter, filters, hasFilters, favoriteCount, running, navigate, onSummary, onTodos, todoCount, toggleTechnology, onConnect, onHelp, onInstall }: Props) {
  const isDemo = !workspace
  return <aside className="sidebar">
      <button type="button" className="brand" onClick={() => navigate('all')}><Logo /><span>local repos<span className="brand-period">.</span></span></button>
      <div className="sidebar-section-label">WORKSPACE</div>
      <WorkspaceNavigation page={page} filter={filter} filters={filters} hasFilters={hasFilters} projectCount={projects.length} favoriteCount={favoriteCount} running={running} navigate={navigate} onSummary={onSummary} onTodos={onTodos} todoCount={todoCount} />
      <div className="sidebar-divider" />
      <div className="sidebar-section-label technology-label">TECHNOLOGIES <span>{stacks.length.toString().padStart(2, '0')}</span></div>
      <nav className="stack-nav" aria-label="Filter by technology">{stacks.map(tech => <button key={tech} aria-pressed={filters.stack?.includes(tech) ?? false} className={filters.stack?.includes(tech) ? 'active' : ''} onClick={() => toggleTechnology(tech)}><span className={`tech-dot tech-${tech.toLowerCase().replace(/[^a-z]/g, '')}`} /><span>{tech}</span><span className="tech-count">{projects.filter(p => p.stack.includes(tech)).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="directory-card"><div className="directory-icon"><FolderOpen size={17} /><span className={isDemo ? 'status-dot neutral' : 'status-dot'} /></div><div><strong>{workspace?.rootName ?? 'Demo workspace'}</strong><span>{isDemo ? 'A look at what’s possible' : workspace.mode === 'helper' ? 'Local helper workspace' : 'Browser folder access'}</span></div><button aria-label="Change directory" disabled={!!busy} onClick={onConnect}><ChevronDown size={15} /></button></div>
        <button className="sidebar-help" onClick={onHelp}><CircleHelp size={15} /><span>How it works</span><ArrowUpRight size={13} /></button>
        {onInstall && <button className="sidebar-help" onClick={onInstall}><Download size={15} /><span>Install Local Repos</span></button>}
        <div className="sidebar-footnote"><span className="status-dot" /> Yours. Locally. <span>v0.1</span></div>
      </div>
    </aside>
}

function WorkspaceNavigation({ page, filter, filters, hasFilters, projectCount, favoriteCount, running, navigate, onSummary, onTodos, todoCount }: NavigationProps) {
  const allActive = page === 'projects' && !hasFilters
  const favoritesActive = page === 'projects' && filter === 'favorites'
  const runningActive = page === 'projects' && filters.server?.includes('running')
  const summaryActive = page === 'summary'
  return <nav className="main-nav" aria-label="Workspace">
        <button aria-current={allActive ? 'page' : undefined} className={allActive ? 'active' : ''} onClick={() => navigate('all')}><LayoutGrid size={17} /><span>All projects</span><span className="nav-count">{projectCount}</span></button>
        <button aria-current={favoritesActive ? 'page' : undefined} className={favoritesActive ? 'active' : ''} onClick={() => navigate('favorites')}><Star size={17} /><span>Favorites</span><span className="nav-count">{favoriteCount.toString().padStart(2, '0')}</span></button>
        <button aria-current={runningActive ? 'page' : undefined} className={runningActive ? 'active' : ''} onClick={() => navigate('running')}><span className="running-icon"><Play size={14} /></span><span>Running</span>{running > 0 && <span className="nav-count">{running}</span>}</button>
        <button aria-current={summaryActive ? 'page' : undefined} className={summaryActive ? 'active' : ''} onClick={onSummary}><CalendarDays size={17} /><span>Daily summary</span></button>
        <button aria-label="Todos" title={todoCount ? `${todoCount} important ${todoCount === 1 ? 'todo' : 'todos'}` : 'Todos'} aria-current={page === 'todos' ? 'page' : undefined} className={page === 'todos' ? 'active' : ''} onClick={onTodos}><ListTodo size={17} /><span>Todos</span>{todoCount > 0 && <span className="todo-nav-count" aria-hidden="true">{todoCount}</span>}</button>
      </nav>
}
