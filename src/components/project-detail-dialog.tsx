import { ScanProgressPanel } from './scan-progress-panel'
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
import { ProjectReactDoctor } from './project-react-doctor'
import { ProjectLighthouse } from './project-lighthouse'
import { ProjectReadme } from './project-readme'
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
import type { GitHistory, OpenProjectRequest, RepoProject } from '@/types'
import { desktopAppName } from '@/lib/desktop-apps'

interface Props {
  scanProgress?: ActiveScanProgress
  onActivity?: (id: string, data: GitHistory, author?: string) => void
  selected?: RepoProject; helper: boolean; demo: boolean; busy: string; packageBusy: string; detailTab: ProjectTab; logs?: string
  tagsReady: boolean; selectedTags: Set<string>; favorite: boolean
  onTabChange: (tab: ProjectTab) => void; onClose: () => void; onCloseAutoFocus: (event: Event) => void
  onTagFilter: (tag: string) => void; onEditTags: (project: RepoProject) => void; onToggleFavorite: (id: string) => void
  onAction: (project: RepoProject, action: string, body?: unknown) => void
}

export function ProjectDetailDialog({ selected, helper, demo, busy, packageBusy, detailTab, logs, tagsReady, selectedTags, favorite, scanProgress, onTabChange, onClose, onCloseAutoFocus, onTagFilter, onEditTags, onToggleFavorite, onAction, onActivity }: Props) {
  const { settings } = useSettings()
  const hasReact = !!selected && isReactProject(selected)
  const hasFrontend = !!selected && (isLighthouseProject(selected) || !!selected.lighthouse)
  const activeTab = (detailTab === 'react-doctor' && !hasReact) || (detailTab === 'lighthouse' && !hasFrontend) ? 'overview' : detailTab
  return <Dialog open={!!selected} onOpenChange={value => { if (!value) onClose() }}><DialogContent className="project-dialog" onCloseAutoFocus={onCloseAutoFocus}>{selected && <><DetailHeader project={selected} demo={demo} tagsReady={tagsReady} selectedTags={selectedTags} onTagFilter={tag => { onTagFilter(tag); onClose() }} onEditTags={onEditTags} />
    {scanProgress && <ScanProgressPanel progress={scanProgress} />}
    <ProjectTabs value={activeTab} onChange={onTabChange} react={hasReact} frontend={hasFrontend}>
      <DetailContent key={selected.id} tab={activeTab} project={selected} helper={helper} demo={demo} busy={busy} packageBusy={packageBusy} logs={logs} onAction={onAction} onActivity={onActivity} />
    </ProjectTabs>
    <div className="detail-footer"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: settings.editor } satisfies OpenProjectRequest)}><Code2 size={15} />{desktopAppName(settings.editor)}</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction(selected, 'open', { app: settings.gitClient } satisfies OpenProjectRequest)}><GitBranch size={15} />{desktopAppName(settings.gitClient)}</Button><Button variant="ghost" size="sm" aria-pressed={favorite} onClick={() => onToggleFavorite(selected.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favorited' : 'Favorite'}</Button></div></>}</DialogContent></Dialog>
}

function DetailHeader({ project, demo, tagsReady, selectedTags, onTagFilter, onEditTags }: Pick<Props, 'demo' | 'tagsReady' | 'selectedTags' | 'onTagFilter' | 'onEditTags'> & { project: RepoProject }) {
  return <div className="detail-header" role="region" aria-label="Project summary" tabIndex={0}><span className="eyebrow"><FolderGit2 size={14} /> PROJECT OVERVIEW</span><DialogTitle>{project.name}</DialogTitle><DialogDescription>{project.description || 'Your local project, at a glance.'}</DialogDescription><div className="detail-tags"><ProjectAiBadge project={project} />{project.monorepo && <span>{project.monorepo.name} / {project.monorepo.packagePath}</span>}{!!project.workspacePackageCount && <span>{project.workspacePackageCount} subprojects</span>}{project.stack.map(tech => <span key={tech}>{tech}</span>)}{demo && <span className="sample-badge">SAMPLE PROJECT</span>}</div><div className="detail-user-tags">{project.tags?.map(tag => <button type="button" className="user-project-tag" key={tag} onClick={() => onTagFilter(tag)} aria-label={`Filter by tag: ${tag}`} aria-pressed={selectedTags.has(tagFilterValue(tag))}><Tag size={12} /><span>{tag}</span></button>)}<button id="edit-detail-tags" type="button" className="edit-project-tags" disabled={!tagsReady} onClick={() => onEditTags(project)}><Tag size={13} />{project.tags?.length ? 'Edit tags' : 'Add tags'}</button></div></div>
}

function DetailContent({ tab, project, helper, demo, busy, packageBusy, logs, onAction, onActivity }: Pick<Props, 'helper' | 'demo' | 'busy' | 'packageBusy' | 'logs' | 'onAction' | 'onActivity'> & { tab: ProjectTab; project: RepoProject }) {
  const action = (name: string, body?: unknown) => { void onAction(project, name, body) }
  const maintenance = { project, helper, demo, busy: packageBusy, onAction: action }
  switch (tab) {
    case 'history': return <ProjectHistory project={project} helper={helper} demo={demo} onActivity={onActivity} />
    case 'development': return <ProjectControls project={project} helper={helper} demo={demo} busy={busy} logs={logs} onAction={action} />
    case 'packages': return <ProjectPackages project={project} />
    case 'vulnerabilities': return <ProjectAudit {...maintenance} />
    case 'updates': return <ProjectOutdated {...maintenance} />
    case 'unused': return <ProjectUnused {...maintenance} />
    case 'react-doctor': return <ProjectReactDoctor {...maintenance} />
    case 'lighthouse': return <ProjectLighthouse {...maintenance} />
    case 'readme': return <ProjectReadme content={project.readme} />
    case 'overview': return <><DetailOverview project={project} /><ProjectStoragePanel project={project} helper={helper} demo={demo} busy={busy} onAction={action} /></>
  }
}

function DetailOverview({ project }: { project: RepoProject }) {
  return <><ProjectPreview project={project} large /><div className="metadata-grid"><div><span>VERSION</span><strong>{project.version ? `v${project.version}` : 'Not specified'}</strong></div><div><span>AUTHOR</span><strong>{project.author || 'Not specified'}</strong></div><div><span>BRANCH</span><strong><GitBranch size={14} />{project.git?.branch || 'Not available'}</strong></div><div><span>LICENSE</span><strong>{project.license || 'Not specified'}</strong></div></div><div className="commit-row"><GitCommitHorizontal size={18} /><div><strong>{project.git?.message || 'No commit information available'}</strong><span>{project.git?.commit?.slice(0, 7)} {project.git?.committedAt && `· ${relativeTime(project.git.committedAt)}`}{project.git?.dirty && ' · Uncommitted changes'}</span></div>{originUrl(project.git?.origin) && <a href={originUrl(project.git?.origin)} target="_blank" rel="noreferrer" title="Open Git remote"><ExternalLink size={16} /></a>}</div></>
}
