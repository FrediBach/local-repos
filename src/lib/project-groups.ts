import type { RepoProject } from '@/types'

interface MonorepoIdentity {
  id: string
  name: string
  relativePath: string
}

export interface ProjectResultGroup {
  id: string
  monorepo?: MonorepoIdentity
  items: { project: RepoProject; index: number }[]
}

/** Keep related projects together at their first position in the selected sort. */
export function groupProjectResults(projects: RepoProject[], allProjects = projects): ProjectResultGroup[] {
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
