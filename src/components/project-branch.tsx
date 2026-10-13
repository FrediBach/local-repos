import { GitBranch } from 'lucide-react'
import { ScanBadgeTooltip } from './scan-badge-tooltip'
import { projectBranchLabel } from '@/lib/project-worktrees'
import { relativeTime } from '@/lib/relative-time'
import type { RepoProject } from '@/types'
import './project-branch.css'

export function ProjectBranch({ project }: { project: RepoProject }) {
  const git = project.git
  const label = projectBranchLabel(project)
  const commits = git?.recentCommits ?? (git?.commit ? [{ hash: git.commit, message: git.message ?? '', committedAt: git.committedAt ?? '' }] : [])
  const trigger = <span className="branch" tabIndex={git ? 0 : undefined}><GitBranch size={13} aria-hidden="true" /><span>{label}</span>{git?.dirty && <i title="Uncommitted changes" />}</span>
  if (!git) return trigger
  return <ScanBadgeTooltip heading={label} scannedAt={project.scannedAt} details={<>
    <span>Latest commits</span>
    {commits.length > 0 && <ol className="branch-commits">{commits.slice(0, 5).map(commit => <li key={commit.hash}>
      <strong>{commit.message || 'Commit message unavailable'}</strong>
      <span><code>{commit.hash.slice(0, 7)}</code>{commit.committedAt && <> · {relativeTime(commit.committedAt)}</>}</span>
    </li>)}</ol>}
    {git.recentCommits === undefined && <p className="branch-history-note">Recent history unavailable. Sync with the local helper to load it.</p>}
    {git.recentCommits?.length === 0 && <p className="branch-history-note">No commits available.</p>}
    {git.dirty && <p className="branch-history-note">Uncommitted changes</p>}
  </>}>{trigger}</ScanBadgeTooltip>
}
