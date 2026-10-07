import { minimatch } from 'minimatch'
import { parse } from 'yaml'

/** Read workspace declarations as data, never project configuration code. */
export function workspacePatterns(manifest?: string, pnpm?: string): string[] {
  let values: unknown
  if (pnpm !== undefined) values = parse(pnpm, { maxAliasCount: 0 })?.packages
  else if (manifest) {
    let workspaces: unknown
    try { workspaces = JSON.parse(manifest)?.workspaces } catch { return [] }
    values = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages
  }
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === 'string' && value.length <= 256)
    .map(value => value.replace(/^(!?)\.\//, '$1').replace(/\/$/, ''))
    .filter(value => !value.replace(/^!/, '').startsWith('/') && !value.includes('\\') && !value.split('/').includes('..') && value !== '.')
    .slice(0, 100)
}

export function matchesWorkspace(relative: string, patterns: string[], partial = false): boolean {
  const options = { nonegate: true, partial }
  return patterns.some(pattern => !pattern.startsWith('!') && minimatch(relative, pattern, options))
    && !patterns.some(pattern => pattern.startsWith('!') && minimatch(relative, pattern.slice(1), { nonegate: true }))
}
