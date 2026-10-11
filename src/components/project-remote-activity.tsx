import { ScanBadgeTooltip } from './scan-badge-tooltip'
import { CircleDot, GitPullRequest } from 'lucide-react'
import { remoteRepository } from '@/lib/remote-activity'
import type { RepoProject } from '@/types'
import './project-remote-activity.css'

export function ProjectRemoteActivity({ project }: { project: RepoProject }) {
  const repository = remoteRepository(project)
  const report = project.remoteActivity
  if (!repository || !report || report.repository !== repository.url) return null
  const scanned = `Last successful check: ${new Date(report.scannedAt).toLocaleString()}`
  const pulls = repository.provider === 'gitlab' ? 'merge requests' : 'pull requests'
  return <div className="project-remote-activity" aria-label="Public repository activity">
    <ScanBadgeTooltip heading="Public issues" details={`${report.issues.length} open issues`} scannedAt={report.scannedAt} dateLabel="Last successful check"><a href={repository.issuesUrl} target="_blank" rel="noreferrer" aria-label={`${project.name}: ${report.issues.length} open issues. ${scanned}`}><CircleDot size={13} aria-hidden="true" />{report.issues.length} issues</a></ScanBadgeTooltip>
    <ScanBadgeTooltip heading={repository.provider === 'gitlab' ? 'Merge requests' : 'Pull requests'} details={`${report.pullRequests.length} open ${pulls}`} scannedAt={report.scannedAt} dateLabel="Last successful check"><a href={repository.pullsUrl} target="_blank" rel="noreferrer" aria-label={`${project.name}: ${report.pullRequests.length} open ${pulls}. ${scanned}`}><GitPullRequest size={13} aria-hidden="true" />{report.pullRequests.length} {repository.provider === 'gitlab' ? 'MRs' : 'PRs'}</a></ScanBadgeTooltip>
  </div>
}
