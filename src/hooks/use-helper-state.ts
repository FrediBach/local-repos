import { useEffect, useRef, useState, type RefObject } from 'react'
import { api, registerHelperWorkspace } from '@/lib/api'
import { cachePreview, preservePreviews } from '@/lib/workspace'
import type { HelperActivity, Workspace, WorkspaceState } from '@/types'

/** Reconcile bounded root snapshots without applying replies to a newer workspace. */
export function useHelperState(options: {
  workspace?: Workspace
  localBusy: string
  workspaceVersion: RefObject<number>
  persist: (workspace: Workspace) => Promise<boolean>
}) {
  const latest = useRef(options)
  latest.current = options
  const [activity, setActivity] = useState<{ path?: string; operations: HelperActivity[] }>({ operations: [] })
  const [error, setError] = useState<string>()
  const path = options.workspace?.mode === 'helper' ? options.workspace.rootPath : undefined
  useEffect(() => {
    if (!path) return
    let active = true
    let pending = false
    let retryAfter = 0
    async function poll() {
      const { workspace, localBusy, workspaceVersion } = latest.current
      if (!workspace || Date.now() < retryAfter || !active || pending || localBusy || document.visibilityState === 'hidden' || workspace?.rootPath !== path) return
      pending = true
      const version = workspaceVersion.current
      const current = () => active && latest.current.workspaceVersion.current === version && !latest.current.localBusy && latest.current.workspace?.rootPath === path
      try {
        let next = workspace
        if (!next.rootId) {
          next = preservePreviews({ ...await registerHelperWorkspace(path!), mode: 'helper' }, workspace)
          if (!current()) return
          if (!next.rootId || !next.helperInstanceId) throw new Error('Restart the helper to enable workspace synchronization.')
          await latest.current.persist(next)
        }
        const state = await api<WorkspaceState>('/workspace-state', { rootId: next.rootId, helperInstanceId: next.helperInstanceId, afterRevision: next.revision })
        if (!current()) return
        if (state.rootId !== next.rootId || typeof state.helperInstanceId !== 'string' || !Number.isSafeInteger(state.revision) || !Array.isArray(state.projects) || !Array.isArray(state.activeOperations) || typeof state.registered !== 'boolean') throw new Error('Invalid workspace snapshot. Restart the helper.')
        if (!state.registered || state.helperInstanceId !== next.helperInstanceId) {
          next = preservePreviews({ ...await registerHelperWorkspace(path!), mode: 'helper' }, next)
          if (!current()) return
          if (!next.rootId || !next.helperInstanceId) throw new Error('Restart the helper to enable workspace synchronization.')
          await latest.current.persist(next)
          setActivity({ path, operations: [] })
          setError(undefined)
          return
        }
        if (state.helperInstanceId === next.helperInstanceId && state.revision < (next.revision ?? 0)) return
        setActivity({ path, operations: state.activeOperations })
        const previousProjects = new Map(next.projects.map(project => [project.id, project]))
        const changedPreview = state.projects.some(project => project.preview && project.preview.capturedAt !== previousProjects.get(project.id)?.preview?.capturedAt)
        let previewWarning: string | undefined
        if (state.revision !== next.revision || changedPreview) {
          next = preservePreviews({ ...next, helperInstanceId: state.helperInstanceId, revision: state.revision, projects: state.projects, warnings: state.warnings }, next)
          next = { ...next, projects: await Promise.all(next.projects.map(async project => {
            if (!project.screenshot?.startsWith('/api/screenshots/')) return project
            try { return { ...project, screenshot: await cachePreview(project.screenshot) } }
            catch {
              previewWarning = 'Reports synchronized, but a preview could not be cached. It will be retried.'
              const previous = previousProjects.get(project.id)
              return { ...project, screenshot: previous?.screenshot, preview: previous?.preview }
            }
          })) }
          if (!current()) return
          if (!next.rootId || !next.helperInstanceId) throw new Error('Restart the helper to enable workspace synchronization.')
          await latest.current.persist(next)
        }
        setError(previewWarning)
      } catch (cause) {
        retryAfter = Date.now() + 30_000
        if (current()) { setActivity({ path, operations: [] }); setError(`Helper synchronization unavailable: ${cause instanceof Error ? cause.message : 'Try again.'}`) }
      } finally { pending = false }
    }
    const timer = window.setInterval(() => { void poll() }, 3000)
    const focus = () => { void poll() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [path])
  return { operations: activity.path === path ? activity.operations : [], error: path ? error : undefined }
}
