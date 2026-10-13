import { activeProjects } from '@/lib/workspace'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { projectHistory, repositoryHistory } from '@/lib/api'
import { repositoryScope, summaryRepositories } from '@/lib/daily-summary'
import { loadCommitActivity, saveCommitActivity } from '@/lib/storage'
import { aggregateCommitActivity, commitMemberships, commitRepositoryId, previewCommitActivity, validCommitActivity, type CommitActivityCache, type PreviewCommitActivity } from '@/lib/commit-activity'
import type { GitHistory, RepositoryGitCoverage, Workspace } from '@/types'

/** Cache history activity on successful helper syncs and from open history views. */
export function useCommitActivity(workspace?: Workspace, syncedWorkspace?: Workspace, author = '') {
  const scope = workspace ? JSON.stringify([workspace.mode, workspace.rootPath ?? workspace.rootName, ...(author ? [author] : [])]) : ''
  const projectsById = useMemo(() => new Map(workspace?.projects.map(project => [project.id, project])), [workspace?.projects])
  const ignoredIds = useMemo(() => new Set(workspace?.ignoredProjectIds), [workspace?.ignoredProjectIds])
  const eligibleProjects = useMemo(() => workspace ? activeProjects(workspace) : [], [workspace])
  const memberships = useMemo(() => commitMemberships(eligibleProjects), [eligibleProjects])
  const membershipKey = JSON.stringify([...memberships].sort(([a], [b]) => a.localeCompare(b)))
  const current = useRef({ scope, workspace, projectsById, ignoredIds })
  useLayoutEffect(() => { current.current = { scope, workspace, projectsById, ignoredIds } }, [scope, workspace, projectsById, ignoredIds])
  const latest = useRef<CommitActivityCache>({ scope: '', repositories: {} })
  const [cache, setCache] = useState<CommitActivityCache>(latest.current)
  useEffect(() => {
    let active = true
    latest.current = { scope, repositories: {} }
    setCache(latest.current)
    if (scope) void (async () => {
      try {
        const saved = await loadCommitActivity()
        if (!active || saved?.scope !== scope) return
        const repositories = Object.fromEntries(Object.entries(saved.repositories ?? {}).filter(([, value]) => validCommitActivity(value)))
        const changed = Object.keys(latest.current.repositories).length > 0
        latest.current = { scope, repositories: { ...repositories, ...latest.current.repositories } }
        setCache(latest.current)
        if (changed) await saveCommitActivity(latest.current)
      } catch { /* History remains usable when its optional cache is unavailable. */ }
    })()
    return () => { active = false }
  }, [scope])

  const remember = useCallback((id: string, data: GitHistory & Partial<RepositoryGitCoverage>, queryAuthor = '', aggregate = false) => {
    if (!scope || current.current.scope !== scope || queryAuthor !== author || !data.available) return
    const projects = current.current.projectsById
    const project = projects.get(id)
    if (!project) return
    // A checkout History response omits detached sibling tips and must not
    // replace repository-wide activity, even when it happens to look complete.
    if (project.gitContext?.state === 'verified' && (!aggregate || data.repositoryId !== project.gitContext.repositoryId)) return
    const membership = project.gitContext?.state === 'verified' && current.current.workspace
      ? commitMemberships(activeProjects(current.current.workspace)).get(project.gitContext.repositoryId) : undefined
    if (project.gitContext?.state === 'verified' && !membership) return
    const report = { activity: data.activity, from: data.from, to: data.to, shallow: data.shallow, cachedAt: new Date().toISOString(), ...(data.coverage === 'partial' ? { partial: true } : {}), ...(membership ? { membership } : {}) }
    if (!validCommitActivity(report)) return
    const validIds = new Set([...projects.values()].map(item => commitRepositoryId(item, projects)))
    const repositories = Object.fromEntries(Object.entries(latest.current.scope === scope ? latest.current.repositories : {}).filter(([key]) => validIds.has(key)))
    repositories[commitRepositoryId(project, projects)] = report
    latest.current = { scope, repositories }
    setCache(latest.current)
    void saveCommitActivity(latest.current).catch(() => { /* Keep the session cache on storage failure. */ })
  }, [scope, author])
  const previousRefresh = useRef({ author, scope, membershipKey })
  useEffect(() => {
    const authorChanged = previousRefresh.current.author !== author
    const membershipChanged = previousRefresh.current.scope === scope && previousRefresh.current.membershipKey !== membershipKey
    previousRefresh.current = { author, scope, membershipKey }
    const source = authorChanged || membershipChanged ? current.current.workspace : syncedWorkspace
    if (!source || source.mode !== 'helper') return
    const syncedScope = JSON.stringify([source.mode, source.rootPath ?? source.rootName, ...(author ? [author] : [])])
    if (syncedScope !== scope) return
    let active = true
    const gitProjects = new Set(source.projects.filter(project => project.git || project.gitContext?.state === 'verified').map(project => project.id))
    const repositories = summaryRepositories(activeProjects(source))
      .filter(repository => gitProjects.has(repository.id))
    let index = 0
    // Like daily summaries, read only local history with at most three requests
    // in flight. Cache each success; a failed repository retains its old report.
    void Promise.all(Array.from({ length: Math.min(3, repositories.length) }, async () => {
      while (active && index < repositories.length) {
        let repository = repositories[index++]
        const live = current.current.workspace
        if (!live) continue
        if (repository.repositoryId) {
          const currentRepository = summaryRepositories(activeProjects(live)).find(item => item.repositoryId === repository.repositoryId)
          if (!currentRepository) continue
          repository = currentRepository
        } else if (current.current.ignoredIds.has(repository.id)) continue
        const requestScope = repositoryScope(repository, source.rootId)
        try {
          const data = await (requestScope ? repositoryHistory(repository.id, requestScope, author ? { author } : {}) : author ? projectHistory(repository.id, { author }) : projectHistory(repository.id))
          const currentRepository = current.current.workspace && summaryRepositories(activeProjects(current.current.workspace)).find(item => item.repositoryId === repository.repositoryId)
          const sameMembers = !requestScope || JSON.stringify(currentRepository?.projectIds) === JSON.stringify(requestScope.projectIds)
          if (active && sameMembers) remember(repository.id, data, author, !!requestScope)
        } catch { /* Preserve dated cached counts rather than replacing failure with zero. */ }
      }
    }))
    return () => { active = false }
  }, [syncedWorkspace, scope, remember, author, membershipKey])

  const today = new Date().toISOString().slice(0, 10)
  const projectActivity = useMemo(() => {
    const result: Record<string, PreviewCommitActivity> = {}
    if (!scope || cache.scope !== scope) return result
    const repositories = new Map(Object.entries(cache.repositories)
      .filter(([id, report]) => validCommitActivity(report) && (!memberships.has(id) || report.membership === memberships.get(id)))
      .map(([id, report]) => [id, previewCommitActivity(report, author, today)]))
    for (const project of projectsById.values()) {
      if (project.gitContext?.state === 'verified' && !memberships.has(project.gitContext.repositoryId)) continue
      const activity = repositories.get(commitRepositoryId(project, projectsById))
      if (activity) result[project.id] = activity
    }
    return result
  }, [scope, cache, projectsById, memberships, author, today])

  return { activity: scope && cache.scope === scope ? aggregateCommitActivity(eligibleProjects, cache.repositories, today, author) : undefined, projectActivity, remember }
}
