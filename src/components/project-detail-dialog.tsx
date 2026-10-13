import { ScanProgressPanel } from './scan-progress-panel'
import { useEffect, useRef } from 'react'
import { ProjectCheckoutContext, ProjectWorktrees } from './project-worktrees'
import { hasWorktreeDetails, projectActionLabel, projectRepository } from '@/lib/project-worktrees'
import type { ActiveScanProgress } from '@/hooks/use-scan-progress'
import { Code2, ExternalLink, FolderGit2, GitBranch, GitCommitHorizontal, Star, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { ProjectAiBadge } from './project-ai-badge'
import { ProjectTabs, type ProjectTab } from './project-tabs'
import { ProjectPackages } from './project-packages'
import { ProjectAudit } from './project-audit'
import { ProjectOutdated } from './project-outdated'
import { ProjectUnused } from './project-unused'
import { ProjectCodeMetrics } from './project-code-metrics'
import { ProjectReactDoctor } from './project-react-doctor'
import { ProjectLighthouse } from './project-lighthouse'
import { ProjectDocumentation } from './project-documentation'
import { ProjectPreview } from './project-preview'
import { ProjectHistory } from './project-history'
import { ProjectControls } from './project-controls'
import { ProjectStoragePanel } from './project-storage'
import { useSettings } from '@/hooks/use-settings'
import { originUrl } from '@/lib/api'
import { relativeTime } from '@/lib/relative-time'
import { tagFilterValue } from '@/lib/project-tags'
import { isReactProject } from '@/lib/react-doctor'
import { isLighthouseProject } from '@/lib/lighthouse'
import type { GitHistory, GitRepository, OpenProjectRequest, RepoProject } from '@/types'
import { desktopAppName } from '@/lib/desktop-apps'
import type { PreviewCommitActivity } from '@/lib/commit-activity'

const emptyProjects: RepoProject[] = []

interface Props {
  repositories?: GitRepository[]
  projects?: RepoProject[]
  ignoredIds?: ReadonlySet<string>
  helperConnected?: boolean
  unavailable?: boolean
  onNavigate?: (project: RepoProject) => void
  onResync?: () => void
  onConnect?: () => void
  activity?: PreviewCommitActivity
  scanProgress?: ActiveScanProgress
  onActivity?: (id: string, data: GitHistory, author?: string) => void
  selected?: RepoProject; helper: boolean; demo: boolean; busy: string; packageBusy: string; detailTab: ProjectTab; logs?: string
  tagsReady: boolean; selectedTags: Set<string>; favorite: boolean
  onTabChange: (tab: ProjectTab) => void; onClose: () => void; onCloseAutoFocus: (event: Event) => void
  onTagFilter: (tag: string) => void; onEditTags: (project: RepoProject) => void; onToggleFavorite: (id: string) => void
  onAction: (project: RepoProject, action: string, body?: unknown) => void
}

export function ProjectDetailDialog({ selected, activity, helper, demo, busy, packageBusy, detailTab, logs, tagsReady, selectedTags, favorite, scanProgress, repositories, projects = emptyProjects, ignoredIds, helperConnected = helper, unavailable, onNavigate, onResync, onConnect, onTabChange, onClose, onCloseAutoFocus, onTagFilter, onEditTags, onToggleFavorite, onAction, onActivity }: Props) {
  const { settings } = useSettings()
  const repository = selected ? projectRepository(selected, repositories) : undefined
  const worktrees = !!selected && hasWorktreeDetails(selected, repository)
  const previousProject = useRef(selected?.id)
  useEffect(() => {
    if (previousProject.current && selected?.id && previousProject.current !== selected.id) document.querySelector<HTMLElement>('.project-dialog .detail-header h2')?.focus()
    previousProject.current = selected?.id
  }, [selected?.id])
  const hasReact = !!selected && isReactProject(selected)
  const hasFrontend = !!selected && (isLighthouseProject(selected) || !!selected.lighthouse)
  const activeTab = (detailTab === 'react-doctor' && !hasReact) || (detailTab === 'lighthouse' && !hasFrontend) || (detailTab === 'worktrees' && !worktrees) ? 'overview' : detailTab
  return <Dialog open={!!selected} onOpenChange={value => { if (!value) onClose() }}><DialogContent className="project-dialog" onCloseAutoFocus={onCloseAutoFocus}>{selected && <><DetailHeader project={selected} repository={repository} demo={demo} tagsReady={tagsReady && !unavailable} selectedTags={selectedTags} onTagFilter={tag => { onTagFilter(tag); onClose() }} onEditTags={onEditTags} />
    {unavailable ? <div className="worktree-unavailable" role="status"><h3>This checkout is unavailable</h3><p>It is no longer available in the connected folder. Reconnect its disk or fix the checkout externally, then sync. No other checkout has been selected.</p><div className="worktree-unavailable-actions"><Button variant="outline" onClick={onClose}>Back to projects</Button>{onResync && <Button variant="outline" disabled={!!busy} onClick={onResync}>Sync folder</Button>}{(selected.dev?.status === 'running' || selected.dev?.status === 'starting') && <Button variant="outline" disabled={!!busy} onClick={() => onAction(selected, 'stop')}>Stop owned server</Button>}</div></div> : <>
    {scanProgress && <ScanProgressPanel progress={scanProgress} />}
    <ProjectTabs value={activeTab} onChange={onTabChange} react={hasReact} frontend={hasFrontend} worktrees={worktrees}>
      {activeTab === 'worktrees' ? <ProjectWorktrees key={selected.id} project={selected} repository={repository} projects={projects} ignoredIds={ignoredIds} helper={helper} demo={demo} connected={helperConnected} busy={busy} onNavigate={onNavigate} onResync={onResync} onConnect={onConnect} /> : <DetailContent key={selected.id} tab={activeTab} project={selected} activity={activity} helper={helper} demo={demo} busy={busy} packageBusy={packageBusy} logs={logs} onAction={onAction} onActivity={onActivity} />}
    </ProjectTabs>
    <div className="detail-footer"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: settings.editor } satisfies OpenProjectRequest)}><Code2 size={15} />{desktopAppName(settings.editor)}</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: settings.gitClient } satisfies OpenProjectRequest)}><GitBranch size={15} />{desktopAppName(settings.gitClient)}</Button><Button variant="ghost" size="sm" aria-pressed={favorite} onClick={() => onToggleFavorite(selected.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favorited' : 'Favorite'}</Button></div></>}</>}</DialogContent></Dialog>
}

function DetailHeader({ project, repository, demo, tagsReady, selectedTags, onTagFilter, onEditTags }: Pick<Props, 'demo' | 'tagsReady' | 'selectedTags' | 'onTagFilter' | 'onEditTags'> & { project: RepoProject; repository?: GitRepository }) {
  return <div className="detail-header" role="region" aria-label="Project summary" tabIndex={0}><span className="eyebrow"><FolderGit2 size={14} /> PROJECT OVERVIEW</span><DialogTitle tabIndex={-1} aria-label={projectActionLabel(project)}>{project.name}</DialogTitle><DialogDescription>{project.description || 'Your local project, at a glance.'}</DialogDescription><ProjectCheckoutContext project={project} repository={repository} /><div className="detail-tags"><ProjectAiBadge project={project} />{project.monorepo && <span>{project.monorepo.name} / {project.monorepo.packagePath}</span>}{!!project.workspacePackageCount && <span>{project.workspacePackageCount} subprojects</span>}{project.stack.map(tech => <span key={tech}>{tech}</span>)}{demo && <span className="sample-badge">SAMPLE PROJECT</span>}</div><div className="detail-user-tags">{project.tags?.map(tag => <button type="button" className="user-project-tag" key={tag} onClick={() => onTagFilter(tag)} aria-label={`Filter by tag: ${tag}`} aria-pressed={selectedTags.has(tagFilterValue(tag))}><Tag size={12} /><span>{tag}</span></button>)}<button id="edit-detail-tags" type="button" className="edit-project-tags" disabled={!tagsReady} onClick={() => onEditTags(project)}><Tag size={13} />{project.tags?.length ? 'Edit tags' : 'Add tags'}</button></div></div>
}

function DetailContent({ tab, project, activity, helper, demo, busy, packageBusy, logs, onAction, onActivity }: Pick<Props, 'activity' | 'helper' | 'demo' | 'busy' | 'packageBusy' | 'logs' | 'onAction' | 'onActivity'> & { tab: ProjectTab; project: RepoProject }) {
  const action = (name: string, body?: unknown) => { void onAction(project, name, body) }
  const maintenance = { project, helper, demo, busy: packageBusy, onAction: action }
  switch (tab) {
    case 'history': return <ProjectHistory project={project} helper={helper} demo={demo} onActivity={onActivity} />
    case 'development': return <ProjectControls project={project} helper={helper} demo={demo} busy={busy} logs={logs} onAction={action} />
    case 'packages': return <ProjectPackages project={project} />
    case 'vulnerabilities': return <ProjectAudit {...maintenance} />
    case 'updates': return <ProjectOutdated {...maintenance} />
    case 'unused': return <><ProjectCodeMetrics report={project.codeMetrics} demo={demo} /><ProjectUnused {...maintenance} /></>
    case 'react-doctor': return <ProjectReactDoctor {...maintenance} />
    case 'lighthouse': return <ProjectLighthouse {...maintenance} />
    case 'overview': return <><DetailOverview project={project} activity={activity} /><ProjectDocumentation project={project} /><ProjectStoragePanel project={project} helper={helper} demo={demo} busy={busy} onAction={action} /></>
  }
}

function DetailOverview({ project, activity }: { project: RepoProject; activity?: PreviewCommitActivity }) {
  return <><ProjectPreview project={project} large activity={activity} /><div className="metadata-grid"><div><span>VERSION</span><strong>{project.version ? `v${project.version}` : 'Not specified'}</strong></div><div><span>AUTHOR</span><strong>{project.author || 'Not specified'}</strong></div><div><span>BRANCH</span><strong><GitBranch size={14} />{project.git?.branch || 'Not available'}</strong></div><div><span>LICENSE</span><strong>{project.license || 'Not specified'}</strong></div></div><div className="commit-row"><GitCommitHorizontal size={18} /><div><strong>{project.git?.message || 'No commit information available'}</strong><span>{project.git?.commit?.slice(0, 7)} {project.git?.committedAt && `· ${relativeTime(project.git.committedAt)}`}{project.git?.dirty && ' · Uncommitted changes'}</span></div>{originUrl(project.git?.origin) && <a href={originUrl(project.git?.origin)} target="_blank" rel="noreferrer" title="Open Git remote"><ExternalLink size={16} /></a>}</div></>
}
