import type { GitDay, GitDayCommit, GitDayQuery, RepoProject, RepositoryGitCoverage, RepositoryGitScope } from '@/types'

export type SummaryRepository = Pick<RepoProject, 'id' | 'name' | 'relativePath'> & { repositoryId?: string; projectIds?: string[] }
export interface SummaryResult { project: SummaryRepository; data?: GitDay & Partial<RepositoryGitCoverage>; error?: string }
export interface SummaryCommit extends GitDayCommit { project: SummaryRepository }

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dayRange(day: string): GitDayQuery | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
  const start = new Date(`${day}T00:00:00`)
  if (!Number.isFinite(start.getTime()) || localDate(start) !== day) return
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function adjacentDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + offset)
  return localDate(date)
}

export function repositoryScope(project: SummaryRepository, rootId?: string): RepositoryGitScope | undefined {
  if (rootId && project.repositoryId && project.projectIds?.length) return { rootId, repositoryId: project.repositoryId, projectIds: project.projectIds }
}

/** Keep an actionable representative while sharing Git history across checkouts. */
export function summaryRepositories(projects: RepoProject[]): SummaryRepository[] {
  const byId = new Map(projects.map(project => [project.id, project]))
  const roots = new Map<string, SummaryRepository>()
  const representativeRank = new Map<string, number>()
  for (let project of projects) {
    if (project.gitContext?.state === 'verified') {
      const key = project.gitContext.repositoryId
      const existing = roots.get(key)
      const rank = (project.gitContext.projectPath === '.' ? 2 : 0) + (project.gitContext.role === 'main' ? 1 : 0)
      if (existing) {
        existing.projectIds!.push(project.id)
        if (rank > (representativeRank.get(key) ?? -1)) {
          Object.assign(existing, { id: project.id, name: project.name, relativePath: project.gitContext.checkoutPath })
          representativeRank.set(key, rank)
        }
      } else {
        roots.set(key, { id: project.id, name: project.name, relativePath: project.gitContext.checkoutPath, repositoryId: key, projectIds: [project.id] })
        representativeRank.set(key, rank)
      }
      continue
    }
    const visited = new Set<string>()
    while (project.monorepo && byId.has(project.monorepo.id) && !visited.has(project.id)) {
      visited.add(project.id)
      project = byId.get(project.monorepo.id)!
    }
    const key = project.monorepo?.id ?? project.id
    if (!roots.has(key)) roots.set(key, { id: project.id, name: project.monorepo?.name ?? project.name, relativePath: project.monorepo?.relativePath ?? project.relativePath })
  }
  return [...roots.values()].sort((a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath))
}

export function summaryCommits(results: SummaryResult[], projectId = '', author = ''): SummaryCommit[] {
  return results.flatMap(({ project, data }) => projectId && project.id !== projectId ? [] : (data?.commits ?? [])
    .filter(commit => !author || commit.email === author).map(commit => ({ ...commit, project })))
    .sort((a, b) => Date.parse(a.committedAt) - Date.parse(b.committedAt) || a.project.id.localeCompare(b.project.id) || a.hash.localeCompare(b.hash))
}

export const commitTime = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const summaryDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const branchLabel = (branch: GitDayCommit['branches'][number]) => `${branch.name}${branch.remote ? ' (remote)' : ''}`
export const branchCount = (commits: SummaryCommit[]) => new Set(commits.flatMap(commit => commit.branches.map(branch => `${commit.project.id}:${branch.ref}`))).size
const counted = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`

export function summaryNotes(results: SummaryResult[]): string[] {
  return results.flatMap(({ project, data, error }) => error ? [`${project.name}: ${error}`] : [
    ...(data?.available === false ? [`${project.name}: Git history is unavailable.`] : []),
    ...(data?.shallow ? [`${project.name}: shallow clone; only downloaded history is available.`] : []),
    ...(data?.coverage === 'partial' ? [`${project.name}: incomplete worktree coverage.`] : []),
    ...(data?.warnings ?? []).map(warning => `${project.name}: ${warning}`),
  ])
}

export function formatDailyReport(day: string, commits: SummaryCommit[], results: SummaryResult[], author = '', projectId = ''): string {
  const groups = new Map<string, SummaryCommit[]>()
  for (const commit of commits) groups.set(commit.project.id, [...(groups.get(commit.project.id) ?? []), commit])
  const notes = summaryNotes(results)
  const lines = [
    `Daily summary — ${summaryDate(day)}`,
    `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} · Author: ${author || 'All authors'}`,
    `Project: ${projectId ? results.find(result => result.project.id === projectId)?.project.name ?? projectId : 'All projects'}`,
    `${counted(commits.length, 'commit')} · ${counted(groups.size, 'project')} · ${counted(branchCount(commits), 'branch', 'branches')}`,
    ...(commits.length ? [`First commit: ${commitTime(commits[0].committedAt)} · Last commit: ${commitTime(commits[commits.length - 1].committedAt)}`] : ['No matching commits.']),
    '', 'PROJECT SUMMARY',
  ]
  for (const group of groups.values()) {
    const project = group[0].project
    lines.push('', `${project.name} (${project.relativePath}) — ${group.length} ${group.length === 1 ? 'commit' : 'commits'}`)
    lines.push(`Branches: ${[...new Set(group.flatMap(commit => commit.branches.map(branchLabel)))].join(', ') || 'No containing branch (detached HEAD)'}`)
    for (const message of new Set(group.map(commit => commit.message || '(No commit message)'))) lines.push(`- ${message}`)
  }
  lines.push('', 'TIMELINE')
  for (const commit of commits) lines.push(`${commitTime(commit.committedAt)} · ${commit.project.name} · ${commit.message || '(No commit message)'} [${commit.hash.slice(0, 7)}] · ${commit.author || commit.email} · ${commit.branches.map(branchLabel).join(', ') || 'No containing branch (detached HEAD)'}`)
  if (notes.length) lines.push('', 'COVERAGE NOTES', ...notes.map(note => `- ${note}`))
  lines.push('', 'Commit times are reference points, not hours worked. Includes locally available branch history; uncommitted work is excluded. Branches contain these commits now; original branches may differ. Shared monorepo and worktree history is counted once.')
  return lines.join('\n')
}
