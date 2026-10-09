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
        <div className="sidebar-footnote"><a href="https://github.com/FrediBach/local-repos" target="_blank" rel="noreferrer"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.725-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.838 1.237 1.838 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.333-5.467-5.93 0-1.31.468-2.38 1.235-3.22-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.005-.404c1.02.005 2.045.138 3.005.404 2.291-1.552 3.297-1.23 3.297-1.23.654 1.652.243 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.622-5.48 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.297 24 17.8 24 12.5 24 5.87 18.627.5 12 .5Z" /></svg>GitHub</a><span>v0.5</span></div>
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
