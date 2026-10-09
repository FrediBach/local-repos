import { Code2, ExternalLink, FolderGit2, GitBranch, GitCommitHorizontal, Star, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { ProjectAiBadge } from './project-ai-badge'
import { ProjectTabs, type ProjectTab } from './project-tabs'
import { ProjectPackages } from './project-packages'
import { ProjectReactDoctor } from './project-react-doctor'
import { ProjectReadme } from './project-readme'
import { ProjectPreview } from './project-preview'
import { ProjectHistory } from './project-history'
import { ProjectControls } from './project-controls'
import { ProjectStoragePanel } from './project-storage'
import { originUrl } from '@/lib/api'
import { relativeTime } from '@/lib/relative-time'
import { tagFilterValue } from '@/lib/project-tags'
import { isReactProject } from '@/lib/react-doctor'
import type { RepoProject } from '@/types'

interface Props {
  selected?: RepoProject; helper: boolean; demo: boolean; busy: string; packageBusy: string; detailTab: ProjectTab; logs?: string
  tagsReady: boolean; selectedTags: Set<string>; favorite: boolean
  onTabChange: (tab: ProjectTab) => void; onClose: () => void; onCloseAutoFocus: (event: Event) => void
  onTagFilter: (tag: string) => void; onEditTags: (project: RepoProject) => void; onToggleFavorite: (id: string) => void
  onAction: (project: RepoProject, action: string, body?: unknown) => void
}

export function ProjectDetailDialog({ selected, helper, demo, busy, packageBusy, detailTab, logs, tagsReady, selectedTags, favorite, onTabChange, onClose, onCloseAutoFocus, onTagFilter, onEditTags, onToggleFavorite, onAction }: Props) {
  const hasReact = !!selected && isReactProject(selected)
  const activeTab = detailTab === 'react-doctor' && !hasReact ? 'overview' : detailTab
  return <Dialog open={!!selected} onOpenChange={value => { if (!value) onClose() }}><DialogContent className="project-dialog" onCloseAutoFocus={onCloseAutoFocus}>{selected && <><DetailHeader project={selected} demo={demo} tagsReady={tagsReady} selectedTags={selectedTags} onTagFilter={tag => { onTagFilter(tag); onClose() }} onEditTags={onEditTags} />
    <ProjectTabs value={activeTab} onChange={onTabChange} react={hasReact}>{activeTab === 'packages' ? <ProjectPackages key={selected.id} project={selected} helper={helper} demo={demo} busy={packageBusy} onAction={name => { void onAction(selected, name) }} /> : activeTab === 'react-doctor' ? <ProjectReactDoctor key={selected.id} project={selected} helper={helper} demo={demo} busy={packageBusy} onAction={name => { void onAction(selected, name) }} /> : activeTab === 'readme' ? <ProjectReadme content={selected.readme} /> : <DetailOverview project={selected} helper={helper} demo={demo} busy={busy} logs={logs} onAction={onAction} />}</ProjectTabs>
    <div className="detail-footer"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: 'vscode' })}><Code2 size={15} />VS Code</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: 'sourcetree' })}><GitBranch size={15} />Sourcetree</Button><Button variant="ghost" size="sm" aria-pressed={favorite} onClick={() => onToggleFavorite(selected.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favorited' : 'Favorite'}</Button></div></>}</DialogContent></Dialog>
}

function DetailHeader({ project, demo, tagsReady, selectedTags, onTagFilter, onEditTags }: Pick<Props, 'demo' | 'tagsReady' | 'selectedTags' | 'onTagFilter' | 'onEditTags'> & { project: RepoProject }) {
  return <div className="detail-header" role="region" aria-label="Project summary" tabIndex={0}><span className="eyebrow"><FolderGit2 size={14} /> PROJECT OVERVIEW</span><DialogTitle>{project.name}</DialogTitle><DialogDescription>{project.description || 'Your local project, at a glance.'}</DialogDescription><div className="detail-tags"><ProjectAiBadge project={project} />{project.monorepo && <span>{project.monorepo.name} / {project.monorepo.packagePath}</span>}{!!project.workspacePackageCount && <span>{project.workspacePackageCount} subprojects</span>}{project.stack.map(tech => <span key={tech}>{tech}</span>)}{demo && <span className="sample-badge">SAMPLE PROJECT</span>}</div><div className="detail-user-tags">{project.tags?.map(tag => <button type="button" className="user-project-tag" key={tag} onClick={() => onTagFilter(tag)} aria-label={`Filter by tag: ${tag}`} aria-pressed={selectedTags.has(tagFilterValue(tag))}><Tag size={12} /><span>{tag}</span></button>)}<button id="edit-detail-tags" type="button" className="edit-project-tags" disabled={!tagsReady} onClick={() => onEditTags(project)}><Tag size={13} />{project.tags?.length ? 'Edit tags' : 'Add tags'}</button></div></div>
}

function DetailOverview({ project, helper, demo, busy, logs, onAction }: Pick<Props, 'helper' | 'demo' | 'busy' | 'logs' | 'onAction'> & { project: RepoProject }) {
  return <><ProjectPreview project={project} large /><div className="metadata-grid"><div><span>VERSION</span><strong>{project.version ? `v${project.version}` : 'Not specified'}</strong></div><div><span>AUTHOR</span><strong>{project.author || 'Not specified'}</strong></div><div><span>BRANCH</span><strong><GitBranch size={14} />{project.git?.branch || 'Not available'}</strong></div><div><span>LICENSE</span><strong>{project.license || 'Not specified'}</strong></div></div><div className="commit-row"><GitCommitHorizontal size={18} /><div><strong>{project.git?.message || 'No commit information available'}</strong><span>{project.git?.commit?.slice(0, 7)} {project.git?.committedAt && `· ${relativeTime(project.git.committedAt)}`}{project.git?.dirty && ' · Uncommitted changes'}</span></div>{originUrl(project.git?.origin) && <a href={originUrl(project.git?.origin)} target="_blank" rel="noreferrer" title="Open Git remote"><ExternalLink size={16} /></a>}</div><ProjectHistory key={`history:${project.id}`} project={project} helper={helper} demo={demo} /><ProjectControls key={project.id} project={project} helper={helper} demo={demo} busy={busy} logs={logs} onAction={(name, body) => { void onAction(project, name, body) }} /><ProjectStoragePanel key={`storage:${project.id}`} project={project} helper={helper} demo={demo} busy={busy} onAction={(name, body) => { void onAction(project, name, body) }} /></>
}
