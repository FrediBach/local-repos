import type { ProjectDependency, RepoProject } from '../types'

/** Match manifest package names, including scoped names, without parsing version specs. */
export function packageMatches(project: Pick<RepoProject, 'dependencies'>, query: string): ProjectDependency[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return (project.dependencies ?? []).filter(({ name }) => name.toLowerCase().includes(normalized))
}

export function dependencyKindLabel(kind: ProjectDependency['kind']): string {
  switch (kind) {
    case 'dependencies': return 'Dependency'
    case 'devDependencies': return 'Dev dependency'
    case 'peerDependencies': return 'Peer dependency'
    case 'optionalDependencies': return 'Optional dependency'
  }
}
