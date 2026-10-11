import { useMemo } from 'react'
import { configureOutdatedReport } from '@/lib/outdated'
import { normalizeTags, type ProjectTags } from '@/lib/project-tags'
import { isRunning } from '@/lib/project-filters'
import { demoProjects } from '@/lib/demo'
import type { AppSettings } from '@/lib/settings'
import type { RepoProject, Workspace } from '@/types'

const emptyProjects: RepoProject[] = []

/** Prepare display metadata without changing the stored scan results. */
export function useWorkspaceProjects(workspace: Workspace | undefined, workspaceStatus: 'loading' | 'ready' | 'error', projectTags: ProjectTags, favorites: string[], settings: AppSettings) {
  const rawProjects = workspace?.projects ?? (workspaceStatus === 'ready' ? demoProjects : emptyProjects)
  const ignoredIds = useMemo(() => new Set(workspace?.ignoredProjectIds ?? []), [workspace?.ignoredProjectIds])
  const ignoredProjects = rawProjects.filter(project => ignoredIds.has(project.id))
  const projects = useMemo(() => rawProjects.filter(project => !ignoredIds.has(project.id)).map(project => ({ ...project, tags: projectTags[project.id] ?? [], ...(project.outdated ? { outdated: configureOutdatedReport(project.outdated, settings) } : {}) })), [rawProjects, projectTags, settings, ignoredIds])
  const availableTags = useMemo(() => normalizeTags(projects.flatMap(project => project.tags)), [projects])
  const isDemo = !workspace && workspaceStatus === 'ready'
  const running = rawProjects.filter(isRunning).length
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const favoriteCount = projects.filter(p => favoriteIds.has(p.id)).length
  const stacks = useMemo(() => [...new Set(projects.flatMap(p => p.stack))].sort((a, b) => projects.filter(p => p.stack.includes(b)).length - projects.filter(p => p.stack.includes(a)).length).slice(0, settings.sidebarTechnologyLimit), [projects, settings.sidebarTechnologyLimit])
  return { rawProjects, ignoredIds, ignoredProjects, projects, isDemo, running, favoriteIds, favoriteCount, stacks, availableTags }
}
