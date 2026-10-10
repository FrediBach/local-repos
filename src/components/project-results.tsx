import { Ellipsis } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import type { ComponentProps } from 'react'
import { ArrowRight, FolderGit2, ShieldCheck } from 'lucide-react'
import { ProjectCard } from './project-card'
import { ProjectEmptyState } from './project-empty-state'
import { groupProjectResults, projectGridTitle, type ProjectResultGroup } from '@/lib/project-groups'
import type { RepoProject } from '@/types'

interface Props extends Omit<ComponentProps<typeof ProjectCard>, 'project' | 'displayName' | 'index' | 'favorite' | 'capturing' | 'todoCount'> {
  ignoredProjects?: RepoProject[]
  projects: RepoProject[]
  allProjects?: RepoProject[]
  favoriteIds: Set<string>
  capturingId?: string
  todoCounts?: Record<string, number>
  filter: 'all' | 'favorites' | 'running'
  hasRefinements: boolean
  emptyWorkspace: boolean
  isDemo: boolean
  onReset: () => void
  onConnect: () => void
}

export function ProjectResults({ ignoredProjects = [], onIgnore, projects, allProjects = projects, favoriteIds, capturingId, filter, hasRefinements, emptyWorkspace, isDemo, onReset, onConnect,
  view, query, activeTags, tagsReady, busy, onOpen, onEditTags, onToggleFavorite, onTagFilter, onTechnologyFilter, onAction, todoCounts, onTodos }: Props) {
  const renderProject = ({ project, index }: ProjectResultGroup['items'][number]) => <ProjectCard key={project.id} project={project} index={index} view={view} query={query}
    displayName={view === 'grid' ? projectGridTitle(project, allProjects) : project.name}
    activeTags={activeTags} tagsReady={tagsReady} favorite={favoriteIds.has(project.id)} capturing={capturingId === project.id} busy={busy} todoCount={todoCounts?.[project.id]} onTodos={onTodos}
    onOpen={onOpen} onEditTags={onEditTags} onToggleFavorite={onToggleFavorite} onIgnore={onIgnore} onTagFilter={onTagFilter} onTechnologyFilter={onTechnologyFilter} onAction={onAction} />
  return <>
        {projects.length ? <div className={`project-results projects-${view}`}>{view === 'grid' ? projects.map((project, index) => renderProject({ project, index })) : groupProjectResults(projects, allProjects).map(group => group.monorepo
          ? <section key={group.id} className="monorepo-group" aria-label={`${group.monorepo.name} monorepo`}>
            <header className="monorepo-group-header"><FolderGit2 size={18} aria-hidden="true" /><div className="monorepo-group-info"><div className="monorepo-group-title"><h2>{group.monorepo.name}</h2><span>Monorepo</span></div><code>{group.monorepo.relativePath}</code></div><span className="monorepo-group-count">{group.items.length} {group.items.length === 1 ? 'project' : 'projects'} shown</span></header>
            <div className={`monorepo-group-projects projects-${view}`}>{group.items.map(renderProject)}</div>
          </section>
          : renderProject(group.items[0]))}</div> : ignoredProjects.length && !allProjects.length ? <p className="empty-state">All projects are ignored. Unignore a project below to bring it back.</p> : <ProjectEmptyState filter={filter} hasRefinements={hasRefinements} emptyWorkspace={emptyWorkspace}
          onReset={onReset} />}
        {!!ignoredProjects.length && <section className="ignored-projects" aria-label="Ignored projects">
          <h2>Ignored projects</h2>
          <div className={`ignored-project-results projects-${view}`}>{ignoredProjects.map(project => <div className="ignored-project" key={project.id}>
            <span>{project.name}</span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><button id={`ignored-project-${project.id}`} className="project-menu" aria-label={`Actions for ignored ${project.name}`}><Ellipsis size={17} /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem disabled={!!busy} onSelect={() => onIgnore?.(project.id)}>Unignore project</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>)}</div>
        </section>}
        <footer className="page-footer">
          <span>{projects.length.toString().padStart(2, '0')} {projects.length === 1 ? 'PROJECT' : 'PROJECTS'}<span className="footer-mid-dot">·</span>{isDemo ? 'A FEW POSSIBILITIES' : 'A LITTLE POSSIBILITY IN EVERY FOLDER'}</span>
          <span className="footer-privacy"><ShieldCheck size={13} /> No cloud. No clutter.</span>
          <span className="footer-copyright">© {new Date().getFullYear()} <a href="https://fredibach.com" target="_blank" rel="noopener noreferrer">Fredi Bach</a></span>
        </footer>
        {isDemo && <div className="demo-note"><span>You’re looking at an example workspace.</span><button onClick={onConnect}>Make it yours <ArrowRight size={13} /></button></div>}
  </>
}
