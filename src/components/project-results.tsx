import type { ComponentProps } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { ProjectCard } from './project-card'
import { ProjectEmptyState } from './project-empty-state'
import type { RepoProject } from '@/types'

interface Props extends Omit<ComponentProps<typeof ProjectCard>, 'project' | 'index' | 'favorite' | 'capturing' | 'todoCount'> {
  projects: RepoProject[]
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

export function ProjectResults({ projects, favoriteIds, capturingId, filter, hasRefinements, emptyWorkspace, isDemo, onReset, onConnect,
  view, query, activeTags, tagsReady, busy, onOpen, onEditTags, onToggleFavorite, onTagFilter, onTechnologyFilter, onAction, todoCounts, onTodos }: Props) {
  return <>
        {projects.length ? <div className={`projects-${view}`}>{projects.map((project, index) => <ProjectCard key={project.id} project={project} index={index} view={view} query={query}
          activeTags={activeTags} tagsReady={tagsReady} favorite={favoriteIds.has(project.id)} capturing={capturingId === project.id} busy={busy} todoCount={todoCounts?.[project.id]} onTodos={onTodos}
          onOpen={onOpen} onEditTags={onEditTags} onToggleFavorite={onToggleFavorite} onTagFilter={onTagFilter} onTechnologyFilter={onTechnologyFilter} onAction={onAction} />)}</div> : <ProjectEmptyState filter={filter} hasRefinements={hasRefinements} emptyWorkspace={emptyWorkspace}
          onReset={onReset} />}
        <footer className="page-footer"><span>{projects.length.toString().padStart(2, '0')} {projects.length === 1 ? 'PROJECT' : 'PROJECTS'}<span className="footer-mid-dot">·</span>{isDemo ? 'A FEW POSSIBILITIES' : 'A LITTLE POSSIBILITY IN EVERY FOLDER'}</span><span><ShieldCheck size={13} /> No cloud. No clutter.</span></footer>
        {isDemo && <div className="demo-note"><span>You’re looking at an example workspace.</span><button onClick={onConnect}>Make it yours <ArrowRight size={13} /></button></div>}
  </>
}
