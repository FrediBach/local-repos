import type { RepoProject } from '../types'
import type { AppSettings } from './settings'
import { desktopAppName } from './desktop-apps'
import { selectDevScript } from './dev-script'
import { discoverProjectScripts, scriptCategories, scriptRunCommand } from './project-scripts'
import { isReactProject } from './react-doctor'

export interface CommandTemplate {
  id: string
  title: string
  description: string
  keywords: string
}

export interface ProjectCommand extends CommandTemplate {
  helper: boolean
  intent: { kind: 'action'; name: string; body?: unknown }
    | { kind: 'details'; tab?: 'overview' | 'packages' | 'react-doctor' | 'readme' }
    | { kind: 'tags' }
    | { kind: 'favorite' }
    | { kind: 'todos' }
}

type Applications = Pick<AppSettings, 'editor' | 'gitClient'>

/** A discoverable vocabulary shared by action-first and project-first search. */
export function commandTemplates(settings: Applications): CommandTemplate[] {
  return [
    { id: 'details', title: 'Project details', description: 'Overview, Git history, development server, and disk usage', keywords: 'open view overview inspect commits history metadata' },
    { id: 'folder', title: 'Open project folder', description: 'Show the project directory in your file manager', keywords: 'finder explorer directory dir files reveal show browse' },
    { id: 'editor', title: `Open in ${desktopAppName(settings.editor)}`, description: 'Open the project in your preferred code editor', keywords: `edit code editor ide ${settings.editor}` },
    { id: 'git-client', title: `Open in ${desktopAppName(settings.gitClient)}`, description: 'Open the project in your preferred Git client', keywords: `git client repository branches ${settings.gitClient}` },
    { id: 'scripts', title: 'Run a script', description: 'Choose a project script and launch it in your terminal', keywords: 'scripts command execute launch terminal npm pnpm yarn bun test build lint format storybook scaffold generate' },
    { id: 'audit', title: 'Scan for vulnerabilities', description: 'Run the package vulnerability check again', keywords: 'audit security vulnerability vulnerabilities rerun rescan check scan again' },
    { id: 'outdated', title: 'Check outdated packages', description: 'Compare installed packages with available versions', keywords: 'rerun rescan scan outdated dependencies versions latest lag updates' },
    { id: 'unused', title: 'Scan unused packages', description: 'Use Knip to find potentially unused dependencies', keywords: 'rerun rescan knip check unused dependencies dead code' },
    { id: 'react-doctor', title: 'Run React Doctor', description: 'Check React code health, performance, and correctness', keywords: 'rerun rescan scan react doctor diagnostics health errors warnings' },
    { id: 'start', title: 'Start development server', description: 'Run the dev, start, or serve script and track its server', keywords: 'dev develop start serve launch app localhost' },
    { id: 'stop', title: 'Stop development server', description: 'Stop the project server managed by Local Repos', keywords: 'dev stop terminate shutdown server' },
    { id: 'logs', title: 'View server logs', description: 'Show development server output in the project overview', keywords: 'dev logs console output debug errors' },
    { id: 'screenshot', title: 'Capture preview', description: 'Refresh the project screenshot or preview image automatically', keywords: 'screenshot image thumbnail capture preview refresh website' },
    { id: 'storage', title: 'Measure disk usage', description: 'Measure project files and the root node_modules directory', keywords: 'storage disk usage space size measure refresh node_modules' },
    { id: 'packages', title: 'Browse packages', description: 'View dependencies and saved maintenance reports', keywords: 'open view packages dependencies versions audit results reports' },
    { id: 'readme', title: 'Read README', description: 'Open the project documentation', keywords: 'readme markdown documentation docs read view' },
    { id: 'tags', title: 'Add or edit tags', description: 'Choose existing labels or create a tag for this project', keywords: 'tag tags label labels add edit remove organize' },
    { id: 'favorite', title: 'Add to favorites', description: 'Toggle this project in your favorites', keywords: 'favorite favorites favourite favourites star starred unstar remove bookmark' },
    { id: 'todos', title: 'View project todos', description: 'Review findings and maintenance tasks for this project', keywords: 'todo todos tasks findings issues priorities' },
    { id: 'update-packages', title: 'Review package updates', description: 'Open Packages to review and apply minor or patch updates', keywords: 'upgrade update packages dependencies minor patch patches install versions' },
    { id: 'cleanup', title: 'Review dependency cleanup', description: 'Open disk usage to measure and review node_modules removal', keywords: 'delete remove cleanup clean free disk space node_modules dependencies' },
  ]
}

/** Describe existing operations only; callers retain connection and busy guards. */
export function projectCommands(project: RepoProject, settings: Applications, favorite: boolean): ProjectCommand[] {
  const running = project.dev?.status === 'running' || project.dev?.status === 'starting'
  const devScript = selectDevScript(project)
  const commands = commandTemplates(settings).flatMap((template): ProjectCommand[] => {
    const action = (name: string, body?: unknown): ProjectCommand[] => [{ ...template, helper: true, intent: { kind: 'action', name, ...(body === undefined ? {} : { body }) } }]
    const details = (tab: 'overview' | 'packages' | 'readme'): ProjectCommand[] => [{ ...template, helper: false, intent: { kind: 'details', tab } }]
    switch (template.id) {
      case 'folder': return action('open', { app: 'folder' })
      case 'editor': return action('open', { app: settings.editor })
      case 'git-client': return action('open', { app: settings.gitClient })
      case 'audit':
      case 'outdated':
      case 'unused': return project.hasPackageJson === false ? [] : action(template.id)
      case 'react-doctor': return isReactProject(project) ? action('react-doctor') : []
      case 'start': return devScript && !running ? action('start') : []
      case 'stop': return running ? action('stop') : []
      case 'logs': return devScript || running ? action('logs') : []
      case 'screenshot': return action('screenshot', { source: 'auto' })
      case 'storage': return action('storage')
      case 'details':
      case 'cleanup': return details('overview')
      case 'packages': return details('packages')
      case 'update-packages': return project.hasPackageJson === false ? [] : details('packages')
      case 'readme': return details('readme')
      case 'tags': return [{ ...template, helper: false, intent: { kind: 'tags' } }]
      case 'favorite': return [{ ...template, title: favorite ? 'Remove favorite' : template.title, helper: false, intent: { kind: 'favorite' } }]
      case 'todos': return [{ ...template, helper: false, intent: { kind: 'todos' } }]
      default: return []
    }
  })
  for (const script of discoverProjectScripts(project)) {
    const category = scriptCategories.find(([id]) => id === script.category)?.[1] ?? script.category
    commands.push({
      id: `script:${script.name}`, title: `Run ${script.name}`,
      description: `${scriptRunCommand(project.packageManager, script.name)} · ${script.command}`,
      keywords: `script scripts execute launch terminal ${category} ${script.category}`,
      helper: true, intent: { kind: 'action', name: 'run-script', body: { name: script.name, command: script.command } },
    })
  }
  return commands
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const fillers = new Set(['the', 'for', 'in', 'a', 'of', 'project'])

/** Score one already-normalized token against an already-normalized word. */
export function commandWordScore(query: string, word: string): number {
  if (word === query) return 60
  if (word.startsWith(query)) return 40
  if (word.includes(query)) return 25
  // Limited abbreviations help discovery without matching unrelated long words.
  if (query.length < 3 || query.length > 6 || word[0] !== query[0] || word.length > query.length + 4) return 0
  let position = 0
  for (const letter of query) {
    const found = word.indexOf(letter, position)
    if (found === -1) return 0
    position = found + 1
  }
  return 10 - (position - query.length)
}

export interface PreparedCommandFields {
  fields: readonly string[]
  words: readonly string[]
}

export interface PreparedCommandQuery {
  normalized: string
  tokens: readonly string[]
  phrase: string
}

/** Prepare stable catalog and project text once, independently of keystrokes. */
export function prepareCommandFields(fields: readonly string[]): PreparedCommandFields {
  const normalized = fields.map(normalize).filter(Boolean)
  return { fields: normalized, words: [...new Set(normalized.flatMap(field => field.split(' ')))] }
}

export function prepareCommandQuery(query: string): PreparedCommandQuery {
  const normalized = normalize(query)
  const allTokens = normalized ? normalized.split(' ') : []
  const meaningfulTokens = allTokens.filter(token => !fillers.has(token))
  // Preserve a search for a literal project named "The" or the word "project".
  const tokens = [...new Set(meaningfulTokens.length ? meaningfulTokens : allTokens)]
  return { normalized, tokens, phrase: tokens.join(' ') }
}

/** Match a prepared command and optional project text without merging them. */
export function preparedCommandMatchScore(query: PreparedCommandQuery, fields: PreparedCommandFields, extraFields?: PreparedCommandFields): number | undefined {
  if (!query.normalized) return 0
  let score = 0
  for (const token of query.tokens) {
    let best = 0
    for (const word of fields.words) {
      best = Math.max(best, commandWordScore(token, word))
      if (best === 60) break
    }
    if (best < 60 && extraFields) for (const word of extraFields.words) {
      best = Math.max(best, commandWordScore(token, word))
      if (best === 60) break
    }
    if (!best) return undefined
    score += best
  }
  const exact = (field: string) => field === query.normalized || field === query.phrase
  const prefix = (field: string) => field.startsWith(query.phrase)
  if (fields.fields.some(exact) || extraFields?.fields.some(exact)) score += 120
  else if (fields.fields.some(prefix) || extraFields?.fields.some(prefix)) score += 10
  return score
}

/** Higher scores rank first. Every meaningful token must match somewhere. */
export function commandMatchScore(query: string, fields: readonly string[]): number | undefined {
  return preparedCommandMatchScore(prepareCommandQuery(query), prepareCommandFields(fields))
}
