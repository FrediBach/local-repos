import type { GitHistory, RepoProject } from '@/types'
import { summaryRepositories } from './daily-summary'

export interface CachedCommitActivity extends Pick<GitHistory, 'activity' | 'from' | 'to' | 'shallow'> { cachedAt: string }
export interface CommitActivityCache { scope: string; repositories: Record<string, CachedCommitActivity> }
const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
export function validCommitActivity(value: unknown): value is CachedCommitActivity {
  if (!value || typeof value !== 'object') return false
  const item = value as CachedCommitActivity
  return dateKey(item.from) && dateKey(item.to) && item.from <= item.to && Number.isFinite(Date.parse(item.cachedAt)) && typeof item.shallow === 'boolean'
    && Array.isArray(item.activity) && item.activity.length <= 366 && item.activity.every(day => dateKey(day.date) && Number.isSafeInteger(day.count) && day.count >= 0)
}

export function commitRepositoryId(project: RepoProject, projects: RepoProject[]): string {
  const seen = new Set<string>()
  while (project.monorepo && !seen.has(project.id)) {
    seen.add(project.id)
    const parent = projects.find(item => item.id === project.monorepo!.id)
    if (!parent) break
    project = parent
  }
  return project.id
}

export function aggregateCommitActivity(projects: RepoProject[], cache: Record<string, CachedCommitActivity>, today = new Date().toISOString().slice(0, 10)) {
  const repositories = summaryRepositories(projects).filter(project => projects.find(item => item.id === project.id)?.git || validCommitActivity(cache[project.id]))
  const reports = repositories.flatMap(project => validCommitActivity(cache[project.id]) ? [cache[project.id]] : [])
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
    days.push({ date, count, covered, partial: covered < repositories.length || reports.some(report => report.shallow) })
  }
  return { days, repositories: repositories.length, cachedRepositories: reports.length, cachedAt: reports.map(report => report.cachedAt).sort()[0] }
}
export type GlobalCommitActivity = NonNullable<ReturnType<typeof aggregateCommitActivity>>
