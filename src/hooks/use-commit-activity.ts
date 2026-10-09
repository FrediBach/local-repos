import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { projectHistory } from '@/lib/api'
import { summaryRepositories } from '@/lib/daily-summary'
import { loadCommitActivity, saveCommitActivity } from '@/lib/storage'
import { aggregateCommitActivity, commitRepositoryId, validCommitActivity, type CommitActivityCache } from '@/lib/commit-activity'
import type { GitHistory, Workspace } from '@/types'

/** Cache history activity on successful helper syncs and from open history views. */
export function useCommitActivity(workspace?: Workspace, syncedWorkspace?: Workspace) {
  const scope = workspace ? JSON.stringify([workspace.mode, workspace.rootPath ?? workspace.rootName]) : ''
  const current = useRef({ scope, projects: workspace?.projects ?? [] })
  useLayoutEffect(() => { current.current = { scope, projects: workspace?.projects ?? [] } }, [scope, workspace?.projects])
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

  const remember = useCallback((id: string, data: GitHistory) => {
    if (!scope || current.current.scope !== scope || !data.available) return
    const project = current.current.projects.find(item => item.id === id)
    if (!project) return
    const report = { activity: data.activity, from: data.from, to: data.to, shallow: data.shallow, cachedAt: new Date().toISOString() }
    if (!validCommitActivity(report)) return
    const allowed = new Set(current.current.projects.map(item => item.id))
    const repositories = Object.fromEntries(Object.entries(latest.current.scope === scope ? latest.current.repositories : {}).filter(([key]) => allowed.has(key)))
    repositories[commitRepositoryId(project, current.current.projects)] = report
    latest.current = { scope, repositories }
    setCache(latest.current)
    void saveCommitActivity(latest.current).catch(() => { /* Keep the session cache on storage failure. */ })
  }, [scope])
  useEffect(() => {
    if (!syncedWorkspace || syncedWorkspace.mode !== 'helper') return
    const syncedScope = JSON.stringify([syncedWorkspace.mode, syncedWorkspace.rootPath ?? syncedWorkspace.rootName])
    if (syncedScope !== scope) return
    let active = true
    const repositories = summaryRepositories(syncedWorkspace.projects)
      .filter(repository => syncedWorkspace.projects.some(project => project.id === repository.id && project.git))
    let index = 0
    // Like daily summaries, read only local history with at most three requests
    // in flight. Cache each success; a failed repository retains its old report.
    void Promise.all(Array.from({ length: Math.min(3, repositories.length) }, async () => {
      while (active && index < repositories.length) {
        const repository = repositories[index++]
        try {
          const data = await projectHistory(repository.id)
          if (active) remember(repository.id, data)
        } catch { /* Preserve dated cached counts rather than replacing failure with zero. */ }
      }
    }))
    return () => { active = false }
  }, [syncedWorkspace, scope, remember])

  return { activity: scope && cache.scope === scope ? aggregateCommitActivity(workspace?.projects ?? [], cache.repositories) : undefined, remember }
}
