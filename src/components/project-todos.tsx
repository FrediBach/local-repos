import { useId, useLayoutEffect, useRef } from 'react'
import { ArrowLeft, ArrowUpRight, CheckCheck, CircleAlert, ClipboardList, Clock3, FolderGit2, Package, ScanLine, ShieldAlert, Stethoscope, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProjectTab } from '@/components/project-tabs'
import { projectTodoOverview, type ProjectTodo } from '@/lib/project-todos'
import type { RepoProject } from '@/types'
import './project-todos.css'

interface Props {
  projects: RepoProject[]
  todos: ProjectTodo[]
  projectId?: string
  onClearProject: () => void
  onOpen: (project: RepoProject, tab?: ProjectTab) => void
  onDismiss: (todo: ProjectTodo) => void
  isDemo: boolean
  onConnect: () => void
}

const kindDetails = {
  security: { label: 'Security', icon: ShieldAlert },
  outdated: { label: 'Package updates', icon: Package },
  'react-doctor': { label: 'React Doctor', icon: Stethoscope },
}

function scanTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function ProjectTodos({ projects, todos, projectId, onClearProject, onOpen, onDismiss, isDemo, onConnect }: Props) {
  const id = useId()
  const section = useRef<HTMLElement>(null)
  const dismissFocus = useRef<{ button: HTMLButtonElement; candidates: HTMLButtonElement[] } | null>(null)
  const { selectedProject, visibleProjects, groups, visibleTodos, scannedProjects, latestScan } = projectTodoOverview(projects, todos, projectId)

  useLayoutEffect(() => {
    const pending = dismissFocus.current
    if (!pending || pending.button.isConnected) return
    dismissFocus.current = null
    // Preserve a focus move the user made while a dismissal was pending.
    if (document.activeElement !== document.body) return
    const target = pending.candidates.find(button => button.isConnected)
      ?? section.current?.querySelector<HTMLElement>('.todos-empty h3')
      ?? section.current?.querySelector<HTMLElement>('h2')
    target?.focus()
  }, [todos, projects, projectId])

  function dismiss(todo: ProjectTodo, button: HTMLButtonElement) {
    const buttons = [...(section.current?.querySelectorAll<HTMLButtonElement>('[data-todo-dismiss]') ?? [])]
    const index = buttons.indexOf(button)
    dismissFocus.current = { button, candidates: [...buttons.slice(index + 1), ...buttons.slice(0, index).reverse()] }
    onDismiss(todo)
  }

  return <section ref={section} className="project-todos" aria-label="Automatic todos">
    <div className="todos-heading">
      <div><span className="eyebrow"><ClipboardList size={14} aria-hidden="true" /> THE IMPORTANT NEXT STEPS</span><h2 tabIndex={-1}>A short list. A clear next step.</h2><p>Important findings from your scans, grouped into a few tasks for each project.</p></div>
      {projectId && <Button variant="outline" size="sm" onClick={onClearProject}><ArrowLeft size={15} aria-hidden="true" />All todos</Button>}
    </div>
    <div className="todos-scope"><p>{projectId ? <><FolderGit2 size={14} aria-hidden="true" />{selectedProject?.name || 'Selected project'}</> : 'Across all projects'}</p><p><Clock3 size={14} aria-hidden="true" />{latestScan ? <>Last scan <time dateTime={latestScan.toISOString()}>{latestScan.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></> : 'No scans yet'}</p></div>
    {isDemo && <div className="todos-demo"><p>Connect your directory to build a todo list from your own project scans.</p><Button variant="outline" size="sm" onClick={onConnect}>Connect directory</Button></div>}
    <dl className="todos-stats" aria-label="Todo overview">
      <div><dt><ClipboardList size={15} aria-hidden="true" />Open todos</dt><dd>{visibleTodos.length}</dd></div>
      <div><dt><CircleAlert size={15} aria-hidden="true" />Critical</dt><dd className={visibleTodos.some(todo => todo.priority === 'critical') ? 'todos-critical-count' : undefined}>{visibleTodos.filter(todo => todo.priority === 'critical').length}</dd></div>
      <div><dt><FolderGit2 size={15} aria-hidden="true" />Projects with todos</dt><dd>{groups.length}</dd></div>
      <div><dt><ScanLine size={15} aria-hidden="true" />Projects scanned</dt><dd>{scannedProjects.length}<span> / {visibleProjects.length}</span></dd></div>
    </dl>
    <div className="todos-section-heading"><h3>{projectId ? 'Project priorities' : 'By project'}</h3><span>Critical first · refreshed with each scan</span></div>
    {groups.length ? <div className="todos-projects">{groups.map(({ project, todos: projectTodos }) => <article className="todos-project" aria-label={`${project.name} todos`} key={project.id}>
      <div className="todos-project-heading"><div><h3>{project.name}</h3><p>{project.relativePath}</p></div><span>{projectTodos.length} {projectTodos.length === 1 ? 'todo' : 'todos'}</span></div>
      <ul>{projectTodos.map(todo => <TodoTask key={todo.id} todo={todo} project={project} dismissNoteId={`${id}-dismiss-note`} onOpen={onOpen} onDismiss={dismiss} />)}</ul>
    </article>)}</div> : <TodoEmptyState projectId={projectId} selectedProject={selectedProject} visibleProjects={visibleProjects} scannedProjects={scannedProjects} onOpen={onOpen} />}
    {scannedProjects.length > 0 && scannedProjects.length < visibleProjects.length && <p className="todos-coverage"><ScanLine size={15} aria-hidden="true" />{visibleProjects.length - scannedProjects.length} {visibleProjects.length - scannedProjects.length === 1 ? 'project has' : 'projects have'} no scans yet. Their findings are not included.</p>}
    <div className="todos-notes"><p>Only high or critical security issues, high package lag, and React Doctor errors make this list. Related findings share a task to keep it short.</p><p id={`${id}-dismiss-note`}>Dismissed findings stay hidden while unchanged. New findings can bring a task back. Rescans remove tasks when their findings are resolved.</p></div>
  </section>
}

function TodoTask({ todo, project, dismissNoteId, onOpen, onDismiss }: {
  todo: ProjectTodo; project: RepoProject; dismissNoteId: string; onOpen: Props['onOpen']; onDismiss: (todo: ProjectTodo, button: HTMLButtonElement) => void
}) {
  const { label, icon: Icon } = kindDetails[todo.kind]
  const scannedAt = scanTime(todo.scannedAt)
  return <li aria-label={todo.title} className="todos-task">
    <div className={`todos-task-icon todos-priority-${todo.priority}`}><Icon size={19} aria-hidden="true" /></div>
    <div className="todos-task-content"><div className="todos-task-meta"><span className={`todos-priority todos-priority-${todo.priority}`}>{todo.priority === 'critical' ? 'Critical' : 'High priority'}</span><span>{label}</span></div><h4>{todo.title}</h4><p>{todo.description}</p><span className="todos-task-date">{scannedAt ? <>Scanned <time dateTime={scannedAt.toISOString()}>{scannedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></> : 'Scan date unavailable'}</span></div>
    <div className="todos-task-actions"><Button variant="outline" size="sm" aria-label={`Review ${todo.title} in ${project.name}`} onClick={() => onOpen(project, todo.tab)}>Review scan<ArrowUpRight size={14} aria-hidden="true" /></Button><Button variant="ghost" size="sm" data-todo-dismiss aria-label={`Dismiss ${todo.title} in ${project.name}`} aria-describedby={dismissNoteId} onClick={event => onDismiss(todo, event.currentTarget)}><X size={14} aria-hidden="true" />Dismiss</Button></div>
  </li>
}

function TodoEmptyState({ projectId, selectedProject, visibleProjects, scannedProjects, onOpen }: {
  projectId?: string; selectedProject?: RepoProject; visibleProjects: RepoProject[]; scannedProjects: RepoProject[]; onOpen: Props['onOpen']
}) {
  const state = projectId && !selectedProject ? 'missing' : !visibleProjects.length ? 'empty' : scannedProjects.length ? 'scanned' : 'unscanned'
  const messages = {
    missing: { title: 'This project is no longer available.', detail: 'Return to all todos to see the projects in this directory.' },
    empty: { title: 'Connect projects to get started.', detail: 'Your project scans will bring their most important findings here.' },
    scanned: { title: 'No important active todos.', detail: 'There are no active tasks from the available scans. Dismissed findings stay hidden; new findings will appear after a scan.' },
    unscanned: { title: 'Run a scan to find important tasks.', detail: 'Run a security audit, outdated package scan, or React Doctor from your projects. Important findings will appear here automatically.' },
  }
  return <div className="todos-empty" role="status">
    {scannedProjects.length ? <CheckCheck size={30} aria-hidden="true" /> : <ScanLine size={30} aria-hidden="true" />}
    <h3 tabIndex={-1}>{messages[state].title}</h3>
    <p>{messages[state].detail}</p>
    {selectedProject && !scannedProjects.length && <Button variant="outline" size="sm" onClick={() => onOpen(selectedProject, 'vulnerabilities')}>Open project scans<ArrowUpRight size={14} aria-hidden="true" /></Button>}
  </div>
}
