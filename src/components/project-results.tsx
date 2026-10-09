import type { ComponentProps } from 'react'
import { ArrowRight, FolderGit2, ShieldCheck } from 'lucide-react'
import { ProjectCard } from './project-card'
import { ProjectEmptyState } from './project-empty-state'
import { groupProjectResults, type ProjectResultGroup } from '@/lib/project-groups'
import type { RepoProject } from '@/types'

interface Props extends Omit<ComponentProps<typeof ProjectCard>, 'project' | 'index' | 'favorite' | 'capturing' | 'todoCount'> {
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

export function ProjectResults({ projects, allProjects = projects, favoriteIds, capturingId, filter, hasRefinements, emptyWorkspace, isDemo, onReset, onConnect,
  view, query, activeTags, tagsReady, busy, onOpen, onEditTags, onToggleFavorite, onTagFilter, onTechnologyFilter, onAction, todoCounts, onTodos }: Props) {
  const renderProject = ({ project, index }: ProjectResultGroup['items'][number]) => <ProjectCard key={project.id} project={project} index={index} view={view} query={query}
    activeTags={activeTags} tagsReady={tagsReady} favorite={favoriteIds.has(project.id)} capturing={capturingId === project.id} busy={busy} todoCount={todoCounts?.[project.id]} onTodos={onTodos}
    onOpen={onOpen} onEditTags={onEditTags} onToggleFavorite={onToggleFavorite} onTagFilter={onTagFilter} onTechnologyFilter={onTechnologyFilter} onAction={onAction} />
  return <>
        {projects.length ? <div className={`project-results projects-${view}`}>{groupProjectResults(projects, allProjects).map(group => group.monorepo
          ? <section key={group.id} className="monorepo-group" aria-label={`${group.monorepo.name} monorepo`}>
            <header className="monorepo-group-header"><FolderGit2 size={18} aria-hidden="true" /><div className="monorepo-group-info"><div className="monorepo-group-title"><h2>{group.monorepo.name}</h2><span>Monorepo</span></div><code>{group.monorepo.relativePath}</code></div><span className="monorepo-group-count">{group.items.length} {group.items.length === 1 ? 'project' : 'projects'} shown</span></header>
            <div className={`monorepo-group-projects projects-${view}`}>{group.items.map(renderProject)}</div>
          </section>
          : renderProject(group.items[0]))}</div> : <ProjectEmptyState filter={filter} hasRefinements={hasRefinements} emptyWorkspace={emptyWorkspace}
          onReset={onReset} />}
        <footer className="page-footer"><span>{projects.length.toString().padStart(2, '0')} {projects.length === 1 ? 'PROJECT' : 'PROJECTS'}<span className="footer-mid-dot">·</span>{isDemo ? 'A FEW POSSIBILITIES' : 'A LITTLE POSSIBILITY IN EVERY FOLDER'}</span><span><ShieldCheck size={13} /> No cloud. No clutter.</span></footer>
        {isDemo && <div className="demo-note"><span>You’re looking at an example workspace.</span><button onClick={onConnect}>Make it yours <ArrowRight size={13} /></button></div>}
  </>
}
