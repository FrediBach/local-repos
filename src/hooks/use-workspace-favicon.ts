import { useEffect, useRef } from 'react'
import { createFaviconIndicator } from '@/lib/favicon'
import { remoteRepository } from '@/lib/remote-activity'
import { packageWorkspaceId } from '@/lib/workspace'
import { newWorkspaceUpdates, rememberWorkspaceReports, type WorkspaceUpdate } from '@/lib/workspace-updates'
import type { RepoProject, Workspace } from '@/types'

interface UpdateHistory {
  scope: string
  projects: RepoProject[]
  unread: Map<string, WorkspaceUpdate>
}

function updateSummary(updates: WorkspaceUpdate[]): string {
  const labels = [
    ['vulnerability', 'vulnerability', 'vulnerabilities'],
    ['pull-request', 'pull/merge request', 'pull/merge requests'],
    ['issue', 'issue', 'issues'],
    ['dependency', 'dependency update', 'dependency updates'],
    ['react-doctor', 'React Doctor error', 'React Doctor errors'],
  ] as const
  return labels.flatMap(([category, singular, plural]) => {
    const count = updates.filter(update => update.category === category).length
    return count ? [`${count} new ${count === 1 ? singular : plural}`] : []
  }).join(', ')
}

/** Session-local unread updates; existing reports seed the baseline on connection. */
export function useWorkspaceFavicon(workspace: Workspace | undefined, projects: RepoProject[]) {
  const scope = workspace ? JSON.stringify([workspace.mode, workspace.rootPath ?? workspace.rootName]) : undefined
  const history = useRef<UpdateHistory | undefined>(undefined)
  const indicator = useRef<ReturnType<typeof createFaviconIndicator> | undefined>(undefined)

  useEffect(() => {
    const favicon = createFaviconIndicator()
    indicator.current = favicon
    const acknowledge = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      history.current?.unread.clear()
      favicon.update(undefined)
    }
    window.addEventListener('focus', acknowledge)
    document.addEventListener('visibilitychange', acknowledge)
    return () => {
      window.removeEventListener('focus', acknowledge)
      document.removeEventListener('visibilitychange', acknowledge)
      favicon.dispose()
      indicator.current = undefined
      history.current = undefined
    }
  }, [])

  useEffect(() => {
    if (!scope || history.current?.scope !== scope) {
      history.current = scope ? { scope, projects, unread: new Map() } : undefined
      indicator.current?.update(undefined)
      return
    }

    const current = history.current
    const updates = newWorkspaceUpdates(current.projects, projects)
    current.projects = rememberWorkspaceReports(current.projects, projects)
    const activeIds = new Set(projects.map(project => project.id))
    const activePackages = new Set(projects.map(packageWorkspaceId))
    const activeRepositories = new Set<string | undefined>(projects.map(project => remoteRepository(project)?.url))
    for (const [key, update] of current.unread) {
      const active = update.category === 'vulnerability' ? activePackages.has(update.scope)
        : update.category === 'issue' || update.category === 'pull-request' ? activeRepositories.has(update.scope)
          : activeIds.has(update.projectId)
      if (!active) current.unread.delete(key)
    }
    if (document.visibilityState === 'visible' && document.hasFocus()) current.unread.clear()
    else for (const update of updates) {
      // Keep the strongest unread alert if a finding resolves and later returns.
      if (current.unread.get(update.key)?.kind !== 'security') current.unread.set(update.key, update)
    }

    const unread = [...current.unread.values()]
    const kind = unread.some(update => update.kind === 'security') ? 'security'
      : unread.some(update => update.kind === 'warning') ? 'warning'
        : unread.length ? 'activity' : undefined
    indicator.current?.update(kind, updateSummary(unread))
  }, [scope, projects])
}
