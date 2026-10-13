import type { GitRepository, RepoProject } from '@/types'

interface MonorepoIdentity {
  id: string
  name: string
  relativePath: string
}

export interface ProjectResultGroup {
  id: string
  monorepo?: MonorepoIdentity
  repository?: GitRepository
  checkouts?: { id: string; path: string; items: ProjectResultGroup['items'] }[]
  items: { project: RepoProject; index: number }[]
}

export function projectGridTitle(project: RepoProject, allProjects: RepoProject[]): string {
  const { monorepo } = project
  if (!monorepo) return project.name
  const parent = allProjects.find(candidate => candidate.id === monorepo.id)
  const parentDirectory = parent?.dirName
    ?? monorepo.relativePath.split('/').filter(part => part && part !== '.').at(-1)
    ?? monorepo.name
  return `${parentDirectory}/${monorepo.packagePath}`
}

/** Keep related projects together at their first position in the selected sort. */
export function groupProjectResults(projects: RepoProject[], allProjects = projects, repositories: readonly GitRepository[] = []): ProjectResultGroup[] {
  const families = new Map(repositories.filter(repository => repository.worktrees.filter(worktree => worktree.role !== 'bare').length > 1).map(repository => [repository.id, repository]))
  const monorepos = new Map<string, MonorepoIdentity>()
  const parents = new Map<string, string>()
  for (const project of [...allProjects, ...projects]) {
    if (project.monorepo) {
      monorepos.set(project.monorepo.id, project.monorepo)
      parents.set(project.id, project.monorepo.id)
    }
    if (project.workspacePackageCount) monorepos.set(project.id, project)
  }

  const groups = new Map<string, ProjectResultGroup>()
  projects.forEach((project, index) => {
    const context = project.gitContext
    const repository = context?.state === 'verified' ? families.get(context.repositoryId) : undefined
    if (repository && context?.state === 'verified') {
      const id = `repository:${repository.id}`
      let group = groups.get(id)
      if (!group) { group = { id, repository, checkouts: [], items: [] }; groups.set(id, group) }
      const item = { project, index }
      group.items.push(item)
      let checkout = group.checkouts!.find(candidate => candidate.id === context.worktreeId)
      if (!checkout) { checkout = { id: context.worktreeId, path: context.checkoutPath, items: [] }; group.checkouts!.push(checkout) }
      checkout.items.push(item)
      return
    }
    let rootId = project.monorepo?.id ?? project.id
    const visited = new Set([rootId])
    while (parents.has(rootId)) {
      const parentId = parents.get(rootId)!
      if (visited.has(parentId)) break
      visited.add(parentId)
      rootId = parentId
    }
    const monorepo = monorepos.get(rootId)
    const id = monorepo ? `monorepo:${monorepo.id}` : `project:${project.id}`
    const group = groups.get(id)
    if (group) group.items.push({ project, index })
    else groups.set(id, { id, monorepo, items: [{ project, index }] })
  })
  return [...groups.values()]
}
