import type { RepoProject } from '../types'
import { packageMatches } from './packages'
import { commandTemplates, prepareCommandFields, prepareCommandQuery, preparedCommandMatchScore, projectCommands, type PreparedCommandFields, type PreparedCommandQuery, type ProjectCommand } from './project-commands'
import type { FilterGroup, FilterKey } from './project-filters'
import type { AppSettings } from './settings'

export interface SearchSelection {
  projectId?: string
  templateId?: string
}

export type WorkspaceCommandId = 'all-projects' | 'favorites' | 'running' | 'summary' | 'todos' | 'resync' | 'connect' | 'help' | 'settings' | 'audit-all' | 'outdated-all' | 'react-doctor-all' | 'lighthouse-all' | 'previews-all' | 'clear-filters'

export interface SearchSuggestion {
  id: string
  title: string
  description: string
  group: string
  helper?: boolean
  intent: { kind: 'project'; projectId: string }
    | { kind: 'template'; templateId: string }
    | { kind: 'command'; projectId: string; command: ProjectCommand }
    | { kind: 'filter'; key: FilterKey; value: string }
    | { kind: 'package'; query: string }
    | { kind: 'workspace'; name: WorkspaceCommandId }
}

interface SearchOptions {
  projects: RepoProject[]
  favorites: readonly string[]
  settings: AppSettings
  filterGroups: FilterGroup[]
  query: string
  selection: SearchSelection
  packagesOnly: boolean
}

interface RankedSuggestion { suggestion: SearchSuggestion; score: number }
type IndexOptions = Pick<SearchOptions, 'projects' | 'favorites' | 'settings' | 'filterGroups'>
type QueryOptions = Pick<SearchOptions, 'query' | 'selection' | 'packagesOnly'>

export interface ProjectSearchIndex {
  search: (options: QueryOptions) => SearchSuggestion[]
}

interface IndexedSuggestion {
  suggestion: SearchSuggestion
  fields: PreparedCommandFields
  bonus: number
  initial?: boolean
}

interface IndexedPackage extends IndexedSuggestion {
  name: string
  version?: string
  projectIds: Set<string>
}

const workspaceCommands: { id: WorkspaceCommandId; title: string; description: string; keywords: string; helper?: boolean }[] = [
  { id: 'all-projects', title: 'Show all projects', description: 'Browse the full workspace', keywords: 'home library repositories reset' },
  { id: 'favorites', title: 'Show favorites', description: 'Browse starred projects', keywords: 'favourites bookmarks stars' },
  { id: 'running', title: 'Show running servers', description: 'Browse projects with a running or starting development server', keywords: 'dev active localhost' },
  { id: 'summary', title: 'Daily summary', description: 'Review local Git activity across your projects', keywords: 'commits history day today yesterday' },
  { id: 'todos', title: 'Show all todos', description: 'Review findings and maintenance tasks across your projects', keywords: 'tasks issues priorities work' },
  { id: 'resync', title: 'Resync workspace', description: 'Refresh project metadata from the connected directory', keywords: 'scan rescan refresh reload discover sync' },
  { id: 'connect', title: 'Connect a directory', description: 'Choose a workspace or connect the local helper', keywords: 'folder open switch change' },
  { id: 'settings', title: 'Open settings', description: 'Applications, appearance, automatic scans, and preferences', keywords: 'configure configuration editor theme colors watcher backups import export' },
  { id: 'help', title: 'Help and getting started', description: 'Learn about Local Repos and connecting a directory', keywords: 'guide documentation how instructions' },
  { id: 'audit-all', title: 'Scan all vulnerabilities', description: 'Check every eligible project in the workspace', keywords: 'audit security vulnerability rerun rescan batch all', helper: true },
  { id: 'outdated-all', title: 'Check all outdated packages', description: 'Check package versions across the workspace', keywords: 'outdated dependencies latest lag rerun rescan batch all', helper: true },
  { id: 'react-doctor-all', title: 'Run React Doctor on all projects', description: 'Check React code health across the workspace', keywords: 'react doctor diagnostics performance rerun rescan batch all', helper: true },
  { id: 'lighthouse-all', title: 'Run Lighthouse on all frontends', description: 'Check performance, accessibility, best practices, and SEO across eligible frontend projects', keywords: 'lighthouse frontend website web vitals performance accessibility seo rerun rescan batch all', helper: true },
  { id: 'previews-all', title: 'Capture all previews', description: 'Refresh project previews across the workspace', keywords: 'screenshot images thumbnails refresh batch all', helper: true },
  { id: 'clear-filters', title: 'Clear search and filters', description: 'Reset the current project refinements', keywords: 'reset remove clear filters search' },
]

const initialFilters: [FilterKey, string][] = [
  ['audit', 'vulnerable'], ['outdated', 'outdated'], ['git', 'dirty'],
  ['server', 'running'], ['storage', 'unmeasured'], ['readme', 'present'],
]

function projectFields(project: RepoProject): string[] {
  return [project.name, project.dirName, project.relativePath, project.description, ...project.stack, ...project.tags ?? [],
    project.git?.branch, project.git?.origin, project.author, project.license, project.packageManager,
    project.monorepo?.name, project.monorepo?.packagePath, project.homepage, ...project.aiInstructionFiles ?? [],
    ...(project.dependencies ?? []).flatMap(dependency => [dependency.name, `${dependency.name}@${dependency.version}`])]
    .filter((field): field is string => !!field)
}

function commandSuggestion(project: RepoProject, command: ProjectCommand, templateSelected: boolean): SearchSuggestion {
  const script = command.id.startsWith('script:')
  return {
    id: `command:${project.id}:${command.id}`,
    title: templateSelected && !script ? project.name : command.title,
    description: templateSelected && !script ? `${command.title} · ${project.relativePath}` : `${project.name} · ${project.relativePath} · ${command.description}`,
    group: script ? 'Scripts' : 'Actions', helper: command.helper,
    intent: { kind: 'command', projectId: project.id, command },
  }
}

function preparePackages(projects: RepoProject[], prepare: typeof prepareCommandFields): IndexedPackage[] {
  const packages = new Map<string, { name: string; versions: Set<string>; projects: Map<string, string> }>()
  const validVersions = new Map<string, boolean>()
  for (const project of projects) for (const dependency of project.dependencies ?? []) {
    // Keep the existing name@range semantics. Non-semver declarations remain
    // discoverable by name without suggesting a version search that cannot work.
    const versionQuery = `${dependency.name}@${dependency.version}`
    const names = [dependency.name]
    if (!validVersions.has(versionQuery)) validVersions.set(versionQuery, !!packageMatches({ dependencies: [dependency] }, versionQuery).length)
    if (validVersions.get(versionQuery)) names.push(versionQuery)
    for (const name of names) {
      const entry = packages.get(name) ?? { name: dependency.name, versions: new Set<string>(), projects: new Map<string, string>() }
      entry.versions.add(dependency.version)
      entry.projects.set(project.id, project.name)
      packages.set(name, entry)
    }
  }
  return [...packages].map(([name, entry]) => {
    const count = entry.projects.size
    const projectNames = [...entry.projects.values()].slice(0, 3).join(', ')
    return { fields: prepare([name]), name: entry.name, version: name === entry.name ? undefined : name.slice(entry.name.length + 1), projectIds: new Set(entry.projects.keys()), bonus: 10, suggestion: {
      id: `package:${name}`, title: name,
      description: `${count} project${count === 1 ? '' : 's'} · ${projectNames}${count > 3 ? ', …' : ''} · ${[...entry.versions].join(', ')}`,
      group: 'Packages', intent: { kind: 'package' as const, query: name },
    } }
  })
}

/** Catalogs, labels, package counts, and normalized fields change with workspace
 * data, not each keystroke. Callers can memoize this index independently of query. */
export function createProjectSearchIndex({ projects, favorites, settings, filterGroups }: IndexOptions): ProjectSearchIndex {
  const preparedFields = new Map<string, PreparedCommandFields>()
  const prepare = (fields: readonly string[]) => {
    const key = JSON.stringify(fields)
    let prepared = preparedFields.get(key)
    if (!prepared) { prepared = prepareCommandFields(fields); preparedFields.set(key, prepared) }
    return prepared
  }
  const favoriteIds = new Set(favorites)
  const indexedProjects = projects.map(project => ({
    id: project.id, fields: prepare(projectFields(project)), bonus: favoriteIds.has(project.id) ? 4 : 0,
    suggestion: {
      id: `project:${project.id}`, title: project.name,
      description: [project.relativePath, project.stack.join(', '), project.tags?.join(', '), project.description].filter(Boolean).join(' · '),
      group: 'Projects', intent: { kind: 'project' as const, projectId: project.id },
    },
    commands: projectCommands(project, settings, favoriteIds.has(project.id)).map(command => ({
      id: command.id, fields: prepare([command.title, command.keywords, command.description]),
      suggestion: commandSuggestion(project, command, false), templateSuggestion: commandSuggestion(project, command, true),
    })),
  }))
  const rows: IndexedSuggestion[] = commandTemplates(settings).map(template => ({
    fields: prepare([template.title, template.keywords, template.description]), bonus: 40, initial: true, suggestion: {
      id: `template:${template.id}`, title: template.title, description: template.description,
      group: 'Actions', intent: { kind: 'template', templateId: template.id },
    },
  }))
  for (const command of workspaceCommands) {
    rows.push({ fields: prepare([command.title, command.keywords, command.description]), bonus: 20, initial: true, suggestion: {
      id: `workspace:${command.id}`, title: command.title, description: command.description,
      group: 'Workspace', helper: command.helper, intent: { kind: 'workspace', name: command.id },
    } })
  }
  for (const group of filterGroups) for (const option of group.options) {
    const initial = (group.key === 'tags' && group.options.indexOf(option) < 2) || initialFilters.some(([key, value]) => group.key === key && option.value === value)
    rows.push({ fields: prepare([group.label, option.label, 'filter show projects']), bonus: 5, initial, suggestion: {
      id: `filter:${group.key}:${option.value}`, title: option.label, description: `Filter by ${group.label.toLowerCase()}`,
      group: 'Filters', intent: { kind: 'filter', key: group.key, value: option.value },
    } })
  }
  const packages = preparePackages(projects, prepare)

  return { search({ query, selection, packagesOnly }) {
    const ranked: RankedSuggestion[] = []
    const term = query.trim()
    const preparedQuery = prepareCommandQuery(term)
    const packageVersionQuery = !/\s/.test(term) && term.indexOf('@', 1) !== -1
    const scoped = !!selection.projectId || !!selection.templateId
    const scores = new Map<PreparedCommandFields, number | undefined>()
    const scoreFields = (fields: PreparedCommandFields) => {
      if (!scores.has(fields)) scores.set(fields, preparedCommandMatchScore(preparedQuery, fields))
      return scores.get(fields)
    }

    const packageProjects = new Set<string>()
    if (packagesOnly || (!scoped && term)) for (const entry of packages) {
      let score = scoreFields(entry.fields)
      if (term.indexOf('@', 1) !== -1) {
        // Prefixes complete partially typed versions. Complete ranges also
        // preserve the package search's semver-overlap matching behavior.
        if (!entry.version) continue
        const overlaps = !!packageMatches({ dependencies: [{ name: entry.name, version: entry.version, kind: 'dependencies' }] }, term).length
        if (overlaps) for (const id of entry.projectIds) packageProjects.add(id)
        if (!overlaps && !entry.suggestion.title.toLowerCase().startsWith(term.toLowerCase())) continue
        score = score ?? 60
      }
      if (score !== undefined) ranked.push({ score: score + entry.bonus, suggestion: entry.suggestion })
    }
    if (packagesOnly) return groupRankedSuggestions(ranked)

    const candidates = selection.projectId ? indexedProjects.filter(project => project.id === selection.projectId) : indexedProjects
    const tokenQueries: PreparedCommandQuery[] = preparedQuery.tokens.map(prepareCommandQuery)
    const tokenMatches = new Map<PreparedCommandFields, boolean>()
    if (scoped || (term && !packageVersionQuery)) for (const project of candidates) {
      for (const command of project.commands) {
        if (selection.templateId && (selection.templateId === 'scripts' ? !command.id.startsWith('script:') : command.id !== selection.templateId)) continue
        // Check command vocabulary once per distinct catalog entry, before
        // considering project metadata. Bare names lead to the project chooser.
        if (!scoped) {
          if (!tokenMatches.has(command.fields)) tokenMatches.set(command.fields, tokenQueries.some(token => preparedCommandMatchScore(token, command.fields) !== undefined))
          if (!tokenMatches.get(command.fields)) continue
        }
        const score = preparedCommandMatchScore(preparedQuery, command.fields, project.fields)
        if (score === undefined) continue
        ranked.push({ score: score + 25 + project.bonus, suggestion: selection.templateId ? command.templateSuggestion : command.suggestion })
      }
    }
    if (scoped) return groupRankedSuggestions(ranked)

    const projectRows: RankedSuggestion[] = []
    for (const project of indexedProjects) {
      const score = packageVersionQuery ? (packageProjects.has(project.id) ? 60 : undefined) : scoreFields(project.fields)
      if (score !== undefined) projectRows.push({ score: score + 80 + project.bonus, suggestion: project.suggestion })
    }
    projectRows.sort((a, b) => b.score - a.score)
    ranked.push(...(term ? projectRows : projectRows.slice(0, 5)))

    for (const row of rows) {
      if (!term && !row.initial) continue
      const score = scoreFields(row.fields)
      if (score !== undefined) ranked.push({ score: score + row.bonus, suggestion: row.suggestion })
    }
    return groupRankedSuggestions(ranked)
  } }
}

/** Keep each heading together while retaining the highest-ranked result first. */
function groupRankedSuggestions(ranked: RankedSuggestion[]): SearchSuggestion[] {
  const groups = new Map<string, SearchSuggestion[]>()
  for (const { suggestion } of ranked.sort((a, b) => b.score - a.score)) {
    const group = groups.get(suggestion.group)
    if (group) group.push(suggestion)
    else groups.set(suggestion.group, [suggestion])
  }
  return [...groups.values()].flat()
}

/** Convenience wrapper for one-off searches. Interactive callers reuse an index.
 * Query text only selects existing catalog operations; it never becomes code. */
export function searchSuggestions({ projects, favorites, settings, filterGroups, ...query }: SearchOptions): SearchSuggestion[] {
  return createProjectSearchIndex({ projects, favorites, settings, filterGroups }).search(query)
}
