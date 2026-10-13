import type { GitHistory, RepoProject } from '@/types'
import { summaryRepositories } from './daily-summary'

export interface CachedCommitActivity extends Pick<GitHistory, 'activity' | 'from' | 'to' | 'shallow'> { cachedAt: string; partial?: boolean; membership?: string }
export interface CommitActivityCache { scope: string; repositories: Record<string, CachedCommitActivity> }
const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
export function validCommitActivity(value: unknown): value is CachedCommitActivity {
  if (!value || typeof value !== 'object') return false
  const item = value as CachedCommitActivity
  return dateKey(item.from) && dateKey(item.to) && item.from <= item.to && Number.isFinite(Date.parse(item.cachedAt)) && typeof item.shallow === 'boolean'
    && Array.isArray(item.activity) && item.activity.length <= 366 && item.activity.every(day => dateKey(day.date) && Number.isSafeInteger(day.count) && day.count >= 0)
}

export function commitRepositoryId(project: RepoProject, projects: ReadonlyMap<string, RepoProject>): string {
  if (project.gitContext?.state === 'verified') return project.gitContext.repositoryId
  const seen = new Set<string>()
  while (project.monorepo && !seen.has(project.id)) {
    seen.add(project.id)
    const parent = projects.get(project.monorepo.id)
    if (!parent) break
    project = parent
  }
  return project.id
}

/** Detached tips depend on which checkouts are currently included, not package count. */
export function commitMemberships(projects: RepoProject[]): Map<string, string> {
  const members = new Map<string, Set<string>>()
  for (const project of projects) {
    if (project.gitContext?.state !== 'verified') continue
    const { repositoryId, worktreeId } = project.gitContext
    const worktrees = members.get(repositoryId) ?? new Set<string>()
    worktrees.add(worktreeId)
    members.set(repositoryId, worktrees)
  }
  return new Map([...members].map(([id, worktrees]) => [id, JSON.stringify([...worktrees].sort())]))
}

export function previewCommitActivity(report: CachedCommitActivity, author = '', today = new Date().toISOString().slice(0, 10)) {
  const counts = new Map(report.activity.map(day => [day.date, day.count]))
  const end = new Date(`${today}T00:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 89)
  const days = []
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    days.push({ date, count: date >= report.from && date <= report.to ? counts.get(date) ?? 0 : undefined })
  }
  return { days, author, cachedAt: report.cachedAt, shallow: report.shallow, ...(report.partial ? { partial: true } : {}) }
}
export type PreviewCommitActivity = ReturnType<typeof previewCommitActivity>

export function aggregateCommitActivity(projects: RepoProject[], cache: Record<string, CachedCommitActivity>, today = new Date().toISOString().slice(0, 10), author = '') {
  const memberships = commitMemberships(projects)
  const gitProjects = new Set(projects.filter(project => project.git).map(project => project.id))
  const repositories = summaryRepositories(projects).filter(project => gitProjects.has(project.id) || project.repositoryId || validCommitActivity(cache[project.id]))
  const reports = repositories.flatMap(project => {
    const report = cache[project.repositoryId ?? project.id]
    return validCommitActivity(report) && (!project.repositoryId || report.membership === memberships.get(project.repositoryId)) ? [report] : []
  })
  if (!reports.length) return
  const end = new Date(`${today}T00:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 12 * 7)
  const counts = reports.map(report => new Map(report.activity.map(day => [day.date, day.count])))
  const days = []
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    let covered = 0
    let count = 0
    reports.forEach((report, index) => {
      if (date >= report.from && date <= report.to) { covered++; count += counts[index].get(date) ?? 0 }
    })
    days.push({ date, count, covered, partial: covered < repositories.length || reports.some(report => report.shallow || report.partial) })
  }
  return { days, author, repositories: repositories.length, cachedRepositories: reports.length, cachedAt: reports.map(report => report.cachedAt).sort()[0] }
}
export type GlobalCommitActivity = NonNullable<ReturnType<typeof aggregateCommitActivity>>
