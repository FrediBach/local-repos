import type { RepoProject } from '@/types'
import type { ThemePreference } from '@/hooks/use-theme'
import { normalizeGitOrigin } from './metadata'
import { normalizeTags, readProjectTags, tagNameLimit, type ProjectTags } from './project-tags'
import { normalizeSettings, type AppSettings } from './settings'

export const configFileSizeLimit = 5 * 1024 * 1024

export interface ProjectPreference {
  id: string
  relativePath?: string
  origin?: string
  /** Empty for repository roots; members use their path within the repository. */
  packagePath?: string
  favorite: boolean
  tags: string[]
}

export interface ConfigBackup {
  format: 'local-repos-config'
  version: 1
  exportedAt: string
  settings: AppSettings
  theme: ThemePreference
  projects: ProjectPreference[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.'

function portableOrigin(value?: string): string | undefined {
  if (value && /^(?:javascript|data|file|blob|vbscript):/i.test(value)) return undefined
  const normalized = value && normalizeGitOrigin(value)
  if (!normalized) return undefined
  const url = new URL(normalized)
  url.search = ''
  // HTTP and SSH checkouts of the same remote share one identity. Preserve path case.
  return `${url.host}${url.pathname}`.replace(/\/$/, '')
}

function projectIdentity(project: RepoProject): Pick<ProjectPreference, 'id' | 'relativePath' | 'origin' | 'packagePath'> {
  const origin = project.git?.origin && normalizeGitOrigin(project.git.origin)
  return {
    id: project.id,
    relativePath: normalizePath(project.relativePath),
    ...(origin ? { origin: `https://${portableOrigin(origin)}` } : {}),
    packagePath: project.monorepo ? normalizePath(project.monorepo.packagePath) : '',
  }
}

/** Export preferences only, including orphaned IDs retained from other directories. */
export function createConfigBackup(settings: AppSettings, theme: ThemePreference, projects: RepoProject[], favorites: string[], tags: ProjectTags): ConfigBackup {
  const identities = new Map(projects.map(project => [project.id, projectIdentity(project)]))
  const ids = new Set([...identities.keys(), ...favorites, ...Object.keys(tags)])
  return {
    format: 'local-repos-config', version: 1, exportedAt: new Date().toISOString(), settings: normalizeSettings(settings), theme,
    projects: [...ids].map(id => ({ ...identities.get(id), id, favorite: favorites.includes(id), tags: normalizeTags(tags[id]) })),
  }
}

export function parseConfigBackup(text: string): ConfigBackup {
  if (new TextEncoder().encode(text).length > configFileSizeLimit) throw new Error('Choose a configuration file smaller than 5 MB.')
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This file is not valid JSON.') }
  if (!isRecord(value) || value.format !== 'local-repos-config') throw new Error('Choose a Local Repos configuration export.')
  if (value.version !== 1) throw new Error('This configuration version is not supported. Update Local Repos before importing it.')
  if (!isRecord(value.settings) || !['system', 'light', 'dark'].includes(value.theme as string) || !Array.isArray(value.projects) || value.projects.length > 10000) {
    throw new Error('This configuration has invalid settings or project preferences.')
  }
  const settings = normalizeSettings(value.settings)
  for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
    if (!Object.hasOwn(value.settings, key)) continue
    if (key === 'auditColors') {
      const colors = value.settings.auditColors
      if (!isRecord(colors) || Object.entries(settings.auditColors).some(([severity, color]) => Object.hasOwn(colors, severity) && colors[severity] !== color)) throw new Error('This configuration has invalid vulnerability colors.')
    } else if (value.settings[key] !== settings[key]) throw new Error(`This configuration has an invalid setting: ${key}.`)
  }
  const ids = new Set<string>()
  const projects = value.projects.map((entry): ProjectPreference => {
    if (!isRecord(entry) || !isText(entry.id) || ids.has(entry.id) || typeof entry.favorite !== 'boolean' || !Array.isArray(entry.tags) ||
      entry.tags.some(tag => !isText(tag) || normalizeTags([tag]).length !== 1 || tag.normalize('NFKC').trim().replace(/\s+/g, ' ').length > tagNameLimit) ||
      ['relativePath', 'origin'].some(key => entry[key] !== undefined && !isText(entry[key])) ||
      entry.packagePath !== undefined && entry.packagePath !== '' && !isText(entry.packagePath) ||
      entry.origin !== undefined && !portableOrigin(entry.origin as string)) {
      throw new Error('This configuration has invalid or duplicate project preferences.')
    }
    ids.add(entry.id)
    return {
      id: entry.id, favorite: entry.favorite, tags: normalizeTags(entry.tags),
      ...(typeof entry.relativePath === 'string' ? { relativePath: normalizePath(entry.relativePath) } : {}),
      ...(typeof entry.origin === 'string' ? { origin: `https://${portableOrigin(entry.origin)}` } : {}),
      ...(typeof entry.packagePath === 'string' ? { packagePath: entry.packagePath ? normalizePath(entry.packagePath) : '' } : {}),
    }
  })
  return { format: 'local-repos-config', version: 1, exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '', settings, theme: value.theme as ThemePreference, projects }
}

export interface ConfigImportResult {
  favorites: string[]
  tags: ProjectTags
  matched: number
  missing: number
  ambiguous: number
  different: number
}

/** Never guess using a display name, overwrite local labels, or replace scanned metadata. */
export function mergeConfigProjects(backup: ConfigBackup, projects: RepoProject[], favorites: string[], tags: ProjectTags): ConfigImportResult {
  const current = projects.map(projectIdentity)
  const stars = new Set(favorites)
  const result: ConfigImportResult = { favorites: [], tags: readProjectTags(tags), matched: 0, missing: 0, ambiguous: 0, different: 0 }
  const proposals: { entry: ProjectPreference; target: ProjectPreference['id'] }[] = []
  for (const entry of backup.projects) {
    const origin = portableOrigin(entry.origin)
    const compatible = (candidate: typeof current[number]) => {
      const candidateOrigin = portableOrigin(candidate.origin)
      return !(origin && candidateOrigin && origin !== candidateOrigin) &&
        (entry.packagePath === undefined || entry.packagePath === candidate.packagePath)
    }
    const exact = current.filter(candidate => candidate.id === entry.id && compatible(candidate))
    const remote = origin ? current.filter(candidate => portableOrigin(candidate.origin) === origin && compatible(candidate)) : []
    const path = entry.relativePath ? current.filter(candidate => candidate.relativePath === entry.relativePath && compatible(candidate)) : []
    // A path disambiguates multiple clones of one remote; it cannot override a conflicting remote.
    const remoteAtPath = remote.filter(candidate => candidate.relativePath === entry.relativePath)
    const candidates = exact.length ? exact : remote.length ? (remoteAtPath.length ? remoteAtPath : remote) : path
    if (candidates.length > 1) { result.ambiguous++; continue }
    if (!candidates.length) {
      const conflicting = current.some(candidate => (candidate.id === entry.id || candidate.relativePath === entry.relativePath) && !compatible(candidate))
      if (conflicting) result.different++
      else result.missing++
      continue
    }
    proposals.push({ entry, target: candidates[0].id })
  }
  const targetCounts = new Map<string, number>()
  for (const { target } of proposals) targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1)
  for (const { entry, target } of proposals) {
    if (targetCounts.get(target)! > 1) { result.ambiguous++; continue }
    result.matched++
    if (entry.favorite) stars.add(target)
    const merged = normalizeTags([...(Object.hasOwn(result.tags, target) ? result.tags[target] : []), ...entry.tags])
    if (merged.length) Object.defineProperty(result.tags, target, { value: merged, enumerable: true, configurable: true, writable: true })
  }
  result.favorites = [...stars]
  return result
}
