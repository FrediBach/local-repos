import { Code2, Ellipsis, FolderGit2, FolderOpen, GitBranch, LoaderCircle, Star, Tag } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ProjectTagChips } from './project-tags'
import { ProjectAiBadge } from './project-ai-badge'
import { ProjectAuditBadge } from './project-audit-badge'
import { ProjectOutdatedBadge } from './project-outdated-badge'
import { ProjectReactDoctorBadge } from './project-react-doctor-badge'
import { ProjectTodoBadge } from './project-todo-badge'
import type { ProjectTab } from './project-tabs'
import { ProjectPreview } from './project-preview'
import { PackageMatches } from './project-packages'
import { formatBytes } from '@/lib/format-bytes'
import { relativeTime } from '@/lib/relative-time'
import { useSettings } from '@/hooks/use-settings'
import type { RepoProject } from '@/types'

interface Props {
  project: RepoProject; index: number; view: 'grid' | 'list'; query: string; activeTags?: string[]; tagsReady: boolean; favorite: boolean; capturing: boolean; busy: string
  onOpen: (project: RepoProject, tab?: ProjectTab) => void; onEditTags: (project: RepoProject) => void
  onToggleFavorite: (id: string) => void; onTagFilter: (tag: string) => void; onTechnologyFilter: (technology: string) => void
  onAction: (project: RepoProject, action: string, body?: unknown) => void
  todoCount?: number
  onTodos?: (project: RepoProject) => void
}

export function ProjectCard({ project, index, view, query, activeTags, tagsReady, favorite, capturing, busy, onOpen, onEditTags, onToggleFavorite, onTagFilter, onTechnologyFilter, onAction, todoCount = 0, onTodos }: Props) {
  const tags = <CardTags project={project} activeTags={activeTags} tagsReady={tagsReady} onTagFilter={onTagFilter} onEditTags={onEditTags} onTechnologyFilter={onTechnologyFilter} />
  const title = <><button id={`project-open-${project.id}`} className="project-title" onClick={() => onOpen(project)}>{project.name}</button><ProjectAiBadge project={project} /></>
  const favoriteButton = <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={() => onToggleFavorite(project.id)} aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${project.name}`} aria-pressed={favorite}><Star size={16} /></button>
  const preview = <button className="preview-button" onClick={() => onOpen(project)} aria-label={`View ${project.name}`}><ProjectPreview project={project} />{capturing && <span className="project-capture-badge" title="Capturing preview"><LoaderCircle size={12} className="spinning" /><span>Capturing preview</span></span>}</button>
  return <article className={`project-card ${capturing ? 'is-capturing' : ''}`} style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}>
    {view === 'grid' ? <div className="project-preview-container">{preview}{favoriteButton}</div> : preview}
    <div className="project-info"><div className="project-title-row">{view === 'list' ? <div className="project-name-tags"><div className="project-name">{title}</div>{tags}</div> : title}<ProjectAuditBadge project={project} onClick={() => onOpen(project, 'packages')} /><ProjectOutdatedBadge project={project} onClick={() => onOpen(project, 'packages')} /><ProjectReactDoctorBadge project={project} onClick={() => onOpen(project, 'react-doctor')} />{view === 'list' && favoriteButton}</div><p className="project-description">{project.description || 'A project waiting for its next chapter. Add a README to tell its story.'}</p><PackageMatches project={project} query={query} />{view === 'grid' && tags}{project.storage && <div className="project-storage-summary" title={`Measured ${new Date(project.storage.measuredAt).toLocaleString()}`}>{project.storage.partial ? '≥ ' : ''}{formatBytes(project.storage.totalBytes)} on disk · {project.storage.partial ? '≥ ' : ''}{formatBytes(project.storage.nodeModulesBytes)} node_modules</div>}</div>
    <CardFooter project={project} tagsReady={tagsReady} favorite={favorite} busy={busy} onOpen={onOpen} onEditTags={onEditTags} onToggleFavorite={onToggleFavorite} onAction={onAction} todoCount={todoCount} onTodos={onTodos} />
  </article>
}

function CardTags({ project, activeTags, tagsReady, onTagFilter, onEditTags, onTechnologyFilter }: Pick<Props, 'project' | 'activeTags' | 'tagsReady' | 'onTagFilter' | 'onEditTags' | 'onTechnologyFilter'>) {
  const { settings } = useSettings()
  return <div className="project-tags"><ProjectTagChips project={project} active={activeTags} ready={tagsReady} onFilter={onTagFilter} onEdit={() => onEditTags(project)} />{project.monorepo && <span className="project-package-path" title={`${project.monorepo.name} / ${project.monorepo.packagePath}`}>{project.monorepo.packagePath}</span>}{!!project.workspacePackageCount && <span>Monorepo root</span>}{project.stack.slice(0, settings.projectTagLimit).map(tech => <button className="technology-tag" key={tech} onClick={() => onTechnologyFilter(tech)}>{tech}</button>)}{!project.stack.length && <span>Repository</span>}{project.dev?.status === 'running' && <span className="running-tag"><span className="status-dot" /> Running</span>}</div>
}

function CardFooter({ project, tagsReady, favorite, busy, onOpen, onEditTags, onToggleFavorite, onAction, todoCount = 0, onTodos }: Pick<Props, 'project' | 'tagsReady' | 'favorite' | 'busy' | 'onOpen' | 'onEditTags' | 'onToggleFavorite' | 'onAction' | 'todoCount' | 'onTodos'>) {
  return <div className="project-footer">{onTodos && <ProjectTodoBadge project={project} count={todoCount} onClick={() => onTodos(project)} />}<span className="branch"><GitBranch size={13} /><span>{project.git?.branch ?? 'No Git branch'}</span>{project.git?.dirty && <i title="Uncommitted changes" />}</span><span className="project-date">{relativeTime(project.git?.committedAt ?? project.updatedAt)}</span><DropdownMenu modal={false}><DropdownMenuTrigger asChild><button className="project-menu" aria-label={`Actions for ${project.name}`}><Ellipsis size={17} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onOpen(project)}><FolderGit2 size={14} />Project details</DropdownMenuItem><DropdownMenuItem disabled={!tagsReady} onSelect={() => onEditTags(project)}><Tag size={14} />Edit tags</DropdownMenuItem><DropdownMenuItem onSelect={() => onToggleFavorite(project.id)}><Star size={14} />{favorite ? 'Remove favorite' : 'Add to favorites'}</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: 'vscode' })}><Code2 size={14} />Open in VS Code</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: 'sourcetree' })}><GitBranch size={14} />Open in Sourcetree</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: 'folder' })}><FolderOpen size={14} />Show in folder</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
}
