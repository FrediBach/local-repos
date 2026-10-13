import { FolderGit2, GitBranch, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { hasWorktreeDetails, projectActionLabel, projectBranchLabel, worktreeBranchLabel, worktreeCountLabel, worktreeNavigation } from '@/lib/project-worktrees'
import type { GitRepository, GitWorktree, RepoProject } from '@/types'
import './project-worktrees.css'

const emptyIgnoredIds: ReadonlySet<string> = new Set()

export function ProjectCheckoutContext({ project, repository, onWorktrees }: { project: RepoProject; repository?: GitRepository; onWorktrees?: () => void }) {
  if (!hasWorktreeDetails(project, repository)) return null
  const context = project.gitContext
  return <div className="project-checkout-context">
    {context?.state === 'verified' ? <><span><GitBranch size={13} aria-hidden="true" />{projectBranchLabel(project)}</span><code>{project.relativePath}</code><span className="worktree-role">{context.role === 'main' ? 'Main worktree' : 'Linked worktree'}</span></> : <span>Git relationship unavailable</span>}
    {onWorktrees && <button type="button" onClick={onWorktrees} aria-label={`View worktrees for ${projectActionLabel(project)}`}><FolderGit2 size={13} aria-hidden="true" />{worktreeCountLabel(repository)}</button>}
  </div>
}

const availabilityLabels: Record<GitWorktree['availability'], string> = {
  available: 'In this folder', outside: 'Outside this folder', missing: 'Missing checkout', unavailable: 'Checkout unavailable', unscanned: 'Not scanned · folder limit reached',
}

interface Props {
  project: RepoProject
  repository?: GitRepository
  projects: RepoProject[]
  ignoredIds?: ReadonlySet<string>
  helper: boolean
  demo?: boolean
  connected?: boolean
  busy: string
  onNavigate?: (project: RepoProject) => void
  onResync?: () => void
  onConnect?: () => void
}

export function ProjectWorktrees({ project, repository, projects, ignoredIds = emptyIgnoredIds, helper, demo = false, connected = helper, busy, onNavigate, onResync, onConnect }: Props) {
  const selectedId = project.gitContext?.state === 'verified' ? project.gitContext.worktreeId : undefined
  const records = repository?.worktrees ?? []
  const checkouts = records.filter(worktree => worktree.role !== 'bare')
  const outside = checkouts.filter(worktree => worktree.availability === 'outside').length
  const inside = checkouts.length - outside
  const rank = (worktree: GitWorktree) => worktree.id === selectedId ? 0 : worktree.role === 'main' && worktree.availability === 'available' ? 1 : worktree.availability === 'available' ? 2 : 3
  const ordered = [...records].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
  return <section className="project-worktrees" aria-label="Repository worktrees">
    <div className="worktrees-heading"><div><h3>{repository?.name ?? 'Worktrees'}</h3>{repository && <p>{repository.status === 'partial' ? 'At least ' : ''}{checkouts.length} {checkouts.length === 1 ? 'worktree' : 'worktrees'} reported · {inside} in this folder{outside > 0 && ` · ${outside} outside it`}</p>}</div>{helper && onResync && <Button variant="outline" size="sm" disabled={!!busy} onClick={onResync}><RefreshCw size={14} aria-hidden="true" />Sync folder</Button>}</div>
    {repository?.checkedAt && <p className="worktrees-scan-time">Last observed <time dateTime={repository.checkedAt}>{new Date(repository.checkedAt).toLocaleString()}</time></p>}
    {demo && <p className="worktrees-notice">These are example worktrees. Each checkout has its own files and project actions. Connect your folder to browse your own.</p>}
    {!helper && !demo && <p className="worktrees-notice">Git relationships cannot be resolved in browser mode. Use the local helper to inspect worktrees.</p>}
    {helper && !connected && <p className="worktrees-notice" role="status">Helper connection unavailable. This is a cached snapshot; live status is unavailable. Sync this folder to retry.</p>}
    {repository?.status === 'unavailable' && <p className="worktrees-notice" role="status">Could not refresh worktrees. The last known inventory is shown.{repository.error && ` ${repository.error}`}</p>}
    {repository?.status === 'partial' && <p className="worktrees-notice">This inventory is incomplete. Sync again or connect a narrower folder to inspect more worktrees.{repository.error && ` ${repository.error}`}</p>}
    {!repository && <p>Worktree relationships are unavailable in this snapshot.{helper && ' Sync this folder with the local helper to inspect them.'}</p>}
    {repository?.status === 'complete' && !records.length && <p>No worktrees were reported.</p>}
    {!!ordered.length && <ul className="worktree-list">{ordered.map(worktree => {
      const members = projects.filter(candidate => candidate.gitContext?.state === 'verified' && candidate.gitContext.worktreeId === worktree.id && candidate.gitContext.repositoryId === repository?.id)
      const ignored = members.filter(candidate => ignoredIds.has(candidate.id))
      const running = members.filter(candidate => candidate.dev?.status === 'running' || candidate.dev?.status === 'starting')
      const navigation = worktreeNavigation(project, worktree, projects, ignoredIds)
      const selected = worktree.id === selectedId
      const statusKnown = (demo || connected) && repository?.status !== 'unavailable' && worktree.availability === 'available'
      return <li key={worktree.id} className="worktree-row" aria-current={selected ? 'true' : undefined}>
        <div className="worktree-row-content"><div className="worktree-row-title"><strong>{worktreeBranchLabel(worktree)}</strong>{selected && <span>Selected</span>}{worktree.role !== 'bare' && <span>{worktree.role === 'main' ? 'Main worktree' : 'Linked worktree'}</span>}</div>
          <code className="worktree-path">{worktree.path}</code>
          <div className="worktree-status"><span>{availabilityLabels[worktree.availability]}</span>{worktree.role !== 'bare' && <span>{statusKnown && worktree.dirty !== undefined ? worktree.dirty ? 'Uncommitted changes' : 'Clean working tree' : 'Working changes unknown'}</span>}{worktree.locked && <span>Locked{worktree.lockReason && ` · ${worktree.lockReason}`}</span>}{worktree.prunable && <span>Stale Git registration{worktree.pruneReason && ` · ${worktree.pruneReason}`}</span>}{ignored.length > 0 && <span>{ignored.length} {ignored.length === 1 ? 'project ignored' : 'projects ignored'}</span>}</div>
          {!!running.length && <details><summary>{running.length} {running.length === 1 ? 'running project' : 'running projects'}{!statusKnown && ' · last known'}</summary><ul>{running.map(member => <li key={member.id}>{member.name} · {member.gitContext?.state === 'verified' ? member.gitContext.projectPath || '.' : member.relativePath}{ignoredIds.has(member.id) && ' · ignored'}</li>)}</ul></details>}
          {navigation?.packagePath && <p>Package: <code>{navigation.packagePath}</code></p>}
          {navigation?.missingPackage && <p><code>{navigation.missingPackage}</code> is not available here; open the checkout overview.</p>}
          {worktree.availability === 'outside' && <p>This location was reported by Git and has not been inspected. Connect a folder containing it to browse its projects.</p>}
          {worktree.availability === 'unscanned' && <p>Connect a narrower folder to inspect this checkout within scan limits.</p>}
          {worktree.availability === 'missing' || worktree.availability === 'unavailable' ? <p>Reconnect the disk or repair the checkout externally, then sync this folder.</p> : null}
        </div>
        {navigation && onNavigate && navigation.project.id !== project.id && <Button variant="outline" size="sm" onClick={() => onNavigate(navigation.project)} aria-label={`${navigation.label}: ${projectActionLabel(navigation.project)}`}>{navigation.label}</Button>}
      </li>
    })}</ul>}
    {onConnect && (!helper || !connected || outside > 0 || records.some(worktree => worktree.availability === 'unscanned')) && <div className="worktrees-connect">{!demo && <p>Connecting another folder replaces the displayed folder and stops its helper-owned development servers.</p>}<Button variant="outline" size="sm" disabled={!!busy} onClick={onConnect}>{demo ? 'Connect your folder' : !helper ? 'Local helper guidance' : 'Connect another folder'}</Button></div>}
  </section>
}
