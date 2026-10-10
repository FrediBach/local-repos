import { normalizeGitOrigin } from './metadata'
import type { RemoteActivityReport, RepoProject } from '../types'

/** Only explicitly supported public hosts; never infer a host from its name. */
export function remoteRepository(project: Pick<RepoProject, 'git'>) {
  const origin = project.git?.origin && normalizeGitOrigin(project.git.origin)
  if (!origin) return undefined
  const url = new URL(origin)
  if (url.port || url.search || !['github.com', 'gitlab.com'].includes(url.hostname)) return undefined
  const parts = url.pathname.replace(/^\//, '').split('/')
  if (parts.length < 2 || (url.hostname === 'github.com' && parts.length !== 2)
    || parts.some(part => !/^[a-z\d_.-]+$/i.test(part) || part === '.' || part === '..' || part === '-')) return undefined
  const provider = url.hostname === 'github.com' ? 'github' : 'gitlab'
  const path = parts.join('/')
  return { provider, path, url: `https://${url.hostname}/${path}`, issuesUrl: `https://${url.hostname}/${path}/${provider === 'gitlab' ? '-/issues' : 'issues'}`, pullsUrl: `https://${url.hostname}/${path}/${provider === 'gitlab' ? '-/merge_requests' : 'pulls'}` } as const
}

export function newRemoteItems(previous: RemoteActivityReport | undefined, next: RemoteActivityReport) {
  if (!previous || previous.repository !== next.repository) return { issues: 0, pullRequests: 0 }
  const issues = new Set(previous.issues)
  const pulls = new Set(previous.pullRequests)
  return { issues: next.issues.filter(id => !issues.has(id)).length, pullRequests: next.pullRequests.filter(id => !pulls.has(id)).length }
}

export function remoteActivityNotice(project: RepoProject, next: RemoteActivityReport): string | undefined {
  const added = newRemoteItems(project.remoteActivity, next)
  if (!added.issues && !added.pullRequests) return undefined
  const parts = [added.issues ? `${added.issues} newly open issue(s)` : '', added.pullRequests ? `${added.pullRequests} newly open ${remoteRepository(project)?.provider === 'gitlab' ? 'merge' : 'pull'} request(s)` : ''].filter(Boolean)
  return `${project.name}: ${parts.join(' and ')}.`
}

/** Repository-level work is shared by visually grouped and independent packages alike. */
export function remoteActivityProjects(projects: RepoProject[]): RepoProject[] {
  const seen = new Set<string>()
  return projects.filter(project => {
    const repository = remoteRepository(project)
    if (!repository || seen.has(repository.url)) return false
    seen.add(repository.url)
    return true
  })
}

export function mergeRemoteActivity(projects: RepoProject[], update: Pick<RepoProject, 'remoteActivity' | 'reportState'>): RepoProject[] {
  return projects.map(project => update.remoteActivity && remoteRepository(project)?.url === update.remoteActivity.repository
    ? { ...project, remoteActivity: update.remoteActivity, reportState: { ...project.reportState, ...update.reportState } } : project)
}
