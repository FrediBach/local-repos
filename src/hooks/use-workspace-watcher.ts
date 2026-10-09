import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { packageWorkspaceId } from '@/lib/workspace'
import type { AppSettings } from '@/lib/settings'
import type { Workspace } from '@/types'

interface WatcherOptions {
  workspace?: Workspace
  settings: AppSettings
  busy: boolean
  online: boolean
  run: (changedIds: string[] | undefined, isCurrent: () => boolean, progress: (message: string) => void) => Promise<Workspace | undefined>
}

const fingerprintsOf = (workspace: Workspace) => Object.fromEntries(workspace.projects.map(project => [project.id, project.packageFingerprint]))

export function useWorkspaceWatcher(options: WatcherOptions) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options }, [options])
  const running = useRef(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [nextRun, setNextRun] = useState<number>()
  const { workspace, settings, online } = options
  const { watcherMode: mode, watcherIntervalMinutes: minutes, watcherPollSeconds: seconds, watcherAudit, watcherOutdated, watcherStorage } = settings

  useEffect(() => {
    // A metadata refresh must not restart the timer or replace its baseline.
    // Read the committed snapshot only when the workspace identity/settings change.
    const initialWorkspace = latest.current.workspace
    setError(false); setStatus(''); setNextRun(undefined)
    if (!initialWorkspace || mode === 'manual' || !online || mode === 'changes' && initialWorkspace.mode !== 'helper') return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let baseline = fingerprintsOf(initialWorkspace)
    const rootPath = initialWorkspace.rootPath
    const delay = mode === 'periodic' ? minutes * 60_000 : seconds * 1000
    const current = () => active
    const publish = (message: string) => { if (active) setStatus(message) }
    const schedule = (wait: number) => {
      if (!active) return
      setNextRun(Date.now() + wait)
      timer = setTimeout(() => { void tick() }, wait)
    }
    async function tick() {
      if (!active) return
      if (running.current || latest.current.busy) { schedule(5000); return }
      running.current = true
      setNextRun(undefined)
      let retryDelay = delay
      try {
        let changedIds: string[] | undefined
        if (mode === 'changes') {
          const result = await api<{ fingerprints: Record<string, string> | null }>('/package-changes', { path: rootPath })
          if (!active) return
          if (result.fingerprints) {
            const snapshot = result.fingerprints
            changedIds = [...new Set([...Object.keys(snapshot), ...Object.keys(baseline)])].filter(id => snapshot[id] !== baseline[id])
            if (!changedIds.length) { setError(false); publish('Watching for package changes'); return }
            // Shared workspaces need sibling checks; other grouped packages are independent.
            const projects = latest.current.workspace!.projects
            const changed = new Set(changedIds)
            const repositories = new Set(projects.filter(project => changed.has(project.id)).map(packageWorkspaceId))
            changedIds = projects.filter(project => changed.has(project.id) || repositories.has(packageWorkspaceId(project))).map(project => project.id)
          }
        }
        // A manual action may have started while the lightweight change check
        // was in flight. Let it finish before acquiring the scan queue.
        if (!active || latest.current.busy) { retryDelay = 5000; return }
        setError(false)
        publish('Refreshing project metadata…')
        const scanned = await latest.current.run(changedIds, current, publish)
        if (active && scanned) {
          baseline = fingerprintsOf(scanned)
          publish(`Last automatic scan ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
        }
      } catch (cause) {
        if (active) { setError(true); publish(cause instanceof Error ? cause.message : 'Automatic scan failed.'); retryDelay = Math.max(delay, 60_000) }
      } finally {
        running.current = false
        schedule(retryDelay)
      }
    }
    schedule(mode === 'changes' ? 0 : delay)
    return () => { active = false; clearTimeout(timer) }
  }, [workspace?.mode, workspace?.rootPath, workspace?.handle, mode, minutes, seconds, watcherAudit, watcherOutdated, watcherStorage, online])

  return { message: watcherMessage(workspace, mode, minutes, online, status), error, nextRun }
}

function watcherMessage(workspace: Workspace | undefined, mode: AppSettings['watcherMode'], minutes: number, online: boolean, status: string): string {
  if (mode === 'manual') return 'Manual scans only'
  if (!workspace) return 'Connect a directory to enable watching'
  if (!online) return 'Watcher paused while offline'
  if (mode === 'changes' && workspace.mode !== 'helper') return 'Package-change watching requires the local helper'
  if (status) return status
  return mode === 'periodic' ? `Automatic scans every ${minutes} min` : 'Watching for package changes'
}
