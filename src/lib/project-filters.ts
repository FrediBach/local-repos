import type { RepoProject } from '../types'
import { selectDevScript } from './dev-script'
import { packageMatches } from './packages'
import { tagFilterValue } from './project-tags'
import { defaultSettings, highestAuditSeverity, type AppSettings } from './settings'

export type FilterKey = 'tags' | 'stars' | 'audit' | 'outdated' | 'git' | 'server' | 'activity' | 'structure' | 'storage' | 'preview' | 'readme' | 'stack' | 'manager' | 'branch' | 'license'
export type ProjectFilters = Partial<Record<FilterKey, string[]>>
export interface FilterContext { favorites: readonly string[]; now: number }
export interface FilterOption {
  value: string
  label: string
  matches: (project: RepoProject, context: FilterContext) => boolean
}
export interface FilterGroup {
  key: FilterKey
  label: string
  section: 'Maintenance' | 'Project' | 'Metadata'
  options: FilterOption[]
  multiple?: boolean
}
export type ProjectSort = 'updated' | 'oldest' | 'name' | 'stack' | 'vulnerabilities' | 'outdated' | 'size' | 'dependencies' | 'favorites'
export const projectSortOptions: { value: ProjectSort; label: string }[] = [
  { value: 'updated', label: 'Last updated' }, { value: 'oldest', label: 'Least recently updated' },
  { value: 'name', label: 'Name A–Z' }, { value: 'stack', label: 'Technology' },
  { value: 'vulnerabilities', label: 'Vulnerability severity' }, { value: 'outdated', label: 'Package lag' },
  { value: 'size', label: 'Largest on disk' }, { value: 'dependencies', label: 'Largest node_modules' },
  { value: 'favorites', label: 'Starred first' },
]

const severities = ['info', 'low', 'moderate', 'high', 'critical'] as const
export const vulnerabilityCount = (p: RepoProject) => severities.reduce((sum, severity) => sum + (p.audit?.counts[severity] ?? 0), 0)
export const isRunning = (p: RepoProject) => p.dev?.status === 'running' || p.dev?.status === 'starting'
const activityTime = (p: RepoProject) => Date.parse(p.updatedAt ?? p.git?.committedAt ?? '')
const day = 86_400_000
const age = (p: RepoProject, context: FilterContext) => (context.now - activityTime(p)) / day
const option = (value: string, label: string, matches: FilterOption['matches']): FilterOption => ({ value, label, matches })

const fixedGroups = (settings: AppSettings): FilterGroup[] => [
  { key: 'audit', label: 'Vulnerabilities', section: 'Maintenance', options: [
    option('vulnerable', 'Has vulnerabilities', p => !!p.audit && vulnerabilityCount(p) > 0),
    option('critical', 'Critical severity', p => (p.audit?.counts.critical ?? 0) > 0),
    option('high', 'High or critical severity', p => (p.audit?.counts.high ?? 0) + (p.audit?.counts.critical ?? 0) > 0),
    option('moderate', 'Moderate or higher severity', p => (p.audit?.counts.moderate ?? 0) + (p.audit?.counts.high ?? 0) + (p.audit?.counts.critical ?? 0) > 0),
    ...(['red', 'orange'] as const).map(color => option(color, `${color === 'red' ? 'Red' : 'Orange'} vulnerability badge`, p => {
      const severity = p.audit && highestAuditSeverity(p.audit)
      return !!severity && settings.auditColors[severity] === color
    })),
    option('clean', 'No reported vulnerabilities', p => !!p.audit && vulnerabilityCount(p) === 0),
    option('unscanned', 'Not scanned for vulnerabilities', p => !p.audit),
  ] },
  { key: 'outdated', label: 'Outdated packages', section: 'Maintenance', options: [
    option('outdated', 'Has outdated packages', p => !!p.outdated?.findings.length),
    option('major', 'Major updates available', p => !!p.outdated?.findings.some(f => f.change === 'major')),
    option('minor', 'Minor updates available', p => !!p.outdated?.findings.some(f => f.change === 'minor')),
    option('patch', 'Patch updates available', p => !!p.outdated?.findings.some(f => f.change === 'patch')),
    option('high', 'High package lag', p => p.outdated?.level === 'high'),
    option('current', 'Up to date · complete scan', p => !!p.outdated && !p.outdated.findings.length && !p.outdated.skipped?.length),
    option('partial', 'Scan has skipped packages', p => !!p.outdated?.skipped?.length),
    option('unscanned', 'Not scanned for outdated packages', p => !p.outdated),
  ] },
  { key: 'storage', label: 'Disk usage', section: 'Maintenance', options: [
    option('installed', 'Has node_modules', p => p.storage?.hasNodeModules === true),
    option('missing', 'No node_modules · measured', p => p.storage?.hasNodeModules === false),
    option('large', `Project size ≥ ${settings.largeProjectGiB} GiB`, p => (p.storage?.totalBytes ?? 0) >= settings.largeProjectGiB * 1024 ** 3),
    option('heavy', `node_modules ≥ ${settings.heavyNodeModulesMiB} MiB`, p => (p.storage?.nodeModulesBytes ?? 0) >= settings.heavyNodeModulesMiB * 1024 ** 2),
    option('unmeasured', 'Disk usage not measured', p => !p.storage),
  ] },
  { key: 'stars', label: 'Stars', section: 'Project', options: [
    option('starred', 'Starred projects', (p, c) => c.favorites.includes(p.id)),
    option('unstarred', 'Unstarred projects', (p, c) => !c.favorites.includes(p.id)),
  ] },
  { key: 'git', label: 'Git status', section: 'Project', options: [
    option('dirty', 'Uncommitted changes', p => p.git?.dirty === true),
    option('clean', 'Clean working tree', p => p.git?.dirty === false),
    option('unknown', 'Working tree status unknown', p => !!p.git && p.git.dirty === undefined),
    option('none', 'No Git metadata', p => !p.git),
  ] },
  { key: 'server', label: 'Development server', section: 'Project', options: [
    option('running', 'Running or starting', isRunning),
    option('stopped', 'Stopped', p => p.dev?.status === 'stopped'),
    option('error', 'Server error', p => p.dev?.status === 'error'),
    option('runnable', 'Has a development script', p => !!selectDevScript(p)),
    option('no-script', 'No development script', p => !selectDevScript(p)),
  ] },
  { key: 'activity', label: 'Last activity', section: 'Project', options: [
    option('week', `Active in the last ${settings.recentActivityDays} days`, (p, c) => age(p, c) <= settings.recentActivityDays),
    option('month', `Active in the last ${settings.activeActivityDays} days`, (p, c) => age(p, c) <= settings.activeActivityDays),
    option('quarter', `Inactive for ${settings.inactiveActivityDays}+ days`, (p, c) => age(p, c) >= settings.inactiveActivityDays),
    option('year', settings.dormantActivityDays === 365 ? 'Inactive for 1+ year' : `Inactive for ${settings.dormantActivityDays}+ days`, (p, c) => age(p, c) >= settings.dormantActivityDays),
    option('unknown', 'Activity date unknown', p => !Number.isFinite(activityTime(p))),
  ] },
  { key: 'structure', label: 'Project structure', section: 'Metadata', options: [
    option('root', 'Monorepo root', p => !!p.workspacePackageCount),
    option('member', 'Monorepo subproject', p => !!p.monorepo),
    option('standalone', 'Standalone project', p => !p.monorepo && !p.workspacePackageCount),
  ] },
  { key: 'preview', label: 'Preview', section: 'Metadata', options: [
    option('captured', 'Has a captured preview', p => !!p.screenshot),
    option('missing', 'No captured preview', p => !p.screenshot),
  ] },
  { key: 'readme', label: 'README', section: 'Metadata', options: [
    option('present', 'Has a README', p => !!p.readme?.trim()),
    option('missing', 'No README', p => !p.readme?.trim()),
  ] },
]

/** Keep selected values available even when a rescan removes their last project. */
export function projectFilterGroups(projects: readonly RepoProject[], filters: ProjectFilters = {}, settings: AppSettings = defaultSettings): FilterGroup[] {
  const fixed = fixedGroups(settings)
  const dynamic = (key: FilterKey, label: string, values: string[], read: (p: RepoProject) => string[], multiple = false): FilterGroup => ({
    key, label, section: 'Metadata', multiple,
    options: [...new Set([...values, ...filters[key] ?? []])].filter(Boolean).sort((a, b) => a.localeCompare(b)).map(value => option(value, value, p => read(p).includes(value))),
  })
  return [
    { key: 'tags', label: 'Tags', section: 'Project', multiple: true, options: [
      ...[...new Set([...projects.flatMap(p => p.tags ?? []), ...(filters.tags ?? []).filter(value => value.startsWith('tag:')).map(value => value.slice(4))])]
        .sort((a, b) => a.localeCompare(b)).map(tag => option(tagFilterValue(tag), tag, p => p.tags?.includes(tag) ?? false)),
      option('untagged', 'Untagged', p => !p.tags?.length),
    ] },
    ...fixed.filter(group => group.section !== 'Metadata'),
    dynamic('stack', 'Technologies', projects.flatMap(p => p.stack), p => p.stack, true),
    dynamic('manager', 'Package managers', ['npm', 'pnpm', 'yarn', 'bun'], p => [p.packageManager], true),
    ...fixed.filter(group => group.section === 'Metadata'),
    dynamic('branch', 'Branch', projects.flatMap(p => p.git?.branch ? [p.git.branch] : []), p => [p.git?.branch ?? '']),
    dynamic('license', 'License', projects.flatMap(p => p.license ? [p.license] : []), p => [p.license ?? '']),
  ]
}

/** OR within a group; AND across groups. Missing reports never count as clean. */
export function matchesProjectFilters(project: RepoProject, filters: ProjectFilters, groups: readonly FilterGroup[], context: FilterContext, except?: FilterKey): boolean {
  return groups.every(group => group.key === except || !filters[group.key]?.length || group.options.some(option => filters[group.key]?.includes(option.value) && option.matches(project, context)))
}

export function matchesProjectSearch(project: RepoProject, query: string, scope: 'all' | 'packages'): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  if (packageMatches(project, query).length) return true
  if (scope === 'packages') return false
  return [project.name, project.description, ...project.stack, ...project.tags ?? [], project.dirName, project.relativePath, project.git?.branch, project.git?.origin, project.author, project.license, project.packageManager, project.monorepo?.name, project.monorepo?.packagePath]
    .filter(Boolean).join(' ').toLowerCase().includes(term)
}

export function filterOptionCounts(projects: readonly RepoProject[], filters: ProjectFilters, groups: readonly FilterGroup[], context: FilterContext): Record<string, Record<string, number>> {
  return Object.fromEntries(groups.map(group => {
    const candidates = projects.filter(p => matchesProjectFilters(p, filters, groups, context, group.key))
    return [group.key, Object.fromEntries([['', candidates.length], ...group.options.map(option => [option.value, candidates.filter(p => option.matches(p, context)).length])])]
  }))
}

export function sortProjects(projects: readonly RepoProject[], sort: ProjectSort, favorites: readonly string[]): RepoProject[] {
  const highestSeverity = (p: RepoProject) => p.audit ? severities.reduce((highest, severity, index) => p.audit!.counts[severity] > 0 ? index + 1 : highest, 0) : -1
  // Reports and dates that are unknown sort last, including in oldest-first order.
  const compareKnown = (a: number | undefined, b: number | undefined, ascending = false) => a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : ascending ? a - b : b - a
  const updated = (p: RepoProject) => {
    const time = activityTime(p)
    return Number.isFinite(time) ? time : undefined
  }
  return [...projects].sort((a, b) => {
    let difference = 0
    switch (sort) {
      case 'name': break
      case 'stack': difference = (a.stack[0] ?? '').localeCompare(b.stack[0] ?? ''); break
      case 'vulnerabilities': difference = highestSeverity(b) - highestSeverity(a) || vulnerabilityCount(b) - vulnerabilityCount(a); break
      case 'outdated': difference = compareKnown(a.outdated?.score, b.outdated?.score); break
      case 'size': difference = compareKnown(a.storage?.totalBytes, b.storage?.totalBytes); break
      case 'dependencies': difference = compareKnown(a.storage?.nodeModulesBytes, b.storage?.nodeModulesBytes); break
      case 'favorites': difference = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)); break
      default: difference = compareKnown(updated(a), updated(b), sort === 'oldest')
    }
    return difference || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}
