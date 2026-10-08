import Range from 'semver/classes/range'
import inc from 'semver/functions/inc'
import type { ProjectDependency, RepoProject } from '../types'

function parseRange(value: string): Range | undefined {
  if (!value.trim()) return undefined
  try { return new Range(value) } catch { return undefined }
}

function rangesOverlap(left: Range, right: Range): boolean {
  const candidates = new Set(['0.0.0'])
  // An overlap starts at a comparator boundary, just after it, or at the first
  // prerelease/stable version of a permitted tuple. Testing complete ranges
  // preserves prerelease opt-ins that pairwise comparator intersections lose.
  for (const range of [left, right]) {
    for (const comparators of range.set) {
      for (const comparator of comparators) {
        if (!comparator.value) continue // The * comparator has no version.
        const version = comparator.semver
        const stable = `${version.major}.${version.minor}.${version.patch}`
        candidates.add(version.version).add(stable).add(`${stable}-0`)
        if (version.prerelease.length) candidates.add(`${version.version}.0`)
        const nextPatch = inc(stable, 'patch')
        if (nextPatch) candidates.add(nextPatch)
      }
    }
  }
  return [...candidates].some(version => left.test(version) && right.test(version))
}

/** Name searches use substrings; name@version searches use the full package name. */
export function packageMatches(project: Pick<RepoProject, 'dependencies'>, query: string): ProjectDependency[] {
  const normalized = query.trim()
  if (!normalized) return []
  // A scoped package's leading @ belongs to its name, not the version separator.
  const separator = normalized.indexOf('@', 1)
  if (separator === -1) {
    return (project.dependencies ?? []).filter(({ name }) => name.toLowerCase().includes(normalized.toLowerCase()))
  }
  const packageName = normalized.slice(0, separator).trim().toLowerCase()
  const requestedRange = parseRange(normalized.slice(separator + 1).trim())
  if (!packageName || !requestedRange) return []
  return (project.dependencies ?? []).filter(({ name, version }) => {
    if (name.toLowerCase() !== packageName) return false
    const declaredRange = parseRange(version)
    return declaredRange ? rangesOverlap(requestedRange, declaredRange) : false
  })
}

export function dependencyKindLabel(kind: ProjectDependency['kind']): string {
  switch (kind) {
    case 'dependencies': return 'Dependency'
    case 'devDependencies': return 'Dev dependency'
    case 'peerDependencies': return 'Peer dependency'
    case 'optionalDependencies': return 'Optional dependency'
  }
}
