import type { RefObject } from 'react'
import { projectAction, scanWithHelper, setHelperWorkspacePath } from '@/lib/api'
import { canReadDirectory, chooseDirectory, scanDirectory } from '@/lib/filesystem'
import { clearWorkspace } from '@/lib/storage'
import { preservePreviews } from '@/lib/workspace'
import { useScanProgress } from './use-scan-progress'
import type { Workspace } from '@/types'

interface BatchControls {
  isActive: () => boolean
  dismiss: () => void
}

interface Options {
  workspace?: Workspace
  busy: string
  path: string
  workspaceVersion: RefObject<number>
  batches: BatchControls[]
  setBusy: (busy: string) => void
  setConnectError: (error: string) => void
  setConnectOpen: (open: boolean) => void
  setHelper: (helper: boolean) => void
  setNotice: (notice: { text: string; error?: boolean }) => void
  persist: (workspace: Workspace, reportError?: boolean, refreshActivity?: boolean) => Promise<boolean>
  clearCriticalAlerts: () => void
  onConnected: () => void
  onForgotten: () => void
}

/** Coordinate directory changes with the existing workspace and batch guards. */
export function useWorkspaceConnection({ workspace, busy, path, workspaceVersion, batches, setBusy, setConnectError, setConnectOpen, setHelper, setNotice, persist, clearCriticalAlerts, onConnected, onForgotten }: Options) {
  const metadataProgress = useScanProgress()
  const dismissBatches = () => { for (const batch of batches) batch.dismiss() }

  async function connect(mode: 'browser' | 'helper') {
    if (busy || batches.some(batch => batch.isActive())) return
    const version = ++workspaceVersion.current
    setBusy('connect'); setConnectError('')
    const scan = metadataProgress.begin('Connecting directory', () => version === workspaceVersion.current)
    try {
      let next: Workspace
      if (mode === 'browser') {
        const handle = await chooseDirectory()
        next = { ...await scanDirectory(handle, scan.report), mode, handle }
      } else {
        if (!path.trim()) throw new Error('Enter the absolute path to your projects directory.')
        next = { ...await scanWithHelper(path.trim(), scan.report), mode }
        setHelper(true)
      }
      if (version !== workspaceVersion.current) return
      if (workspace?.mode === 'helper' && (next.mode !== 'helper' || next.rootPath !== workspace.rootPath)) await stopWorkspaceServers(workspace)
      clearCriticalAlerts()
      next = preservePreviews(next, workspace)
      scan.report({ phase: 'Saving project metadata' })
      const cached = await persist(next, true, true); dismissBatches(); onConnected(); setConnectOpen(false)
      if (cached) setNotice({ text: `Connected ${next.rootName}. Found ${next.projects.length} project${next.projects.length === 1 ? '' : 's'}.${next.warnings?.length ? ` ${next.warnings.length} scan note(s) — see workspace info.` : ''}` })
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setConnectError(error instanceof Error ? error.message : 'Unable to connect to this directory.') }
    finally { scan.finish(); if (version === workspaceVersion.current) setBusy('') }
  }
  async function resync() {
    if (busy || batches.some(batch => batch.isActive())) return
    if (!workspace) { setConnectOpen(true); return }
    const version = ++workspaceVersion.current
    setBusy('sync')
    const scan = metadataProgress.begin('Syncing project metadata', () => version === workspaceVersion.current)
    try {
      let next: Workspace
      if (workspace.mode === 'helper' && workspace.rootPath) next = { ...await scanWithHelper(workspace.rootPath, scan.report), mode: 'helper' }
      else if (workspace.handle) {
        if (!await canReadDirectory(workspace.handle, true)) throw new Error('Folder permission is needed to resync. Please allow read access and try again.')
        next = { ...await scanDirectory(workspace.handle, scan.report), mode: 'browser', handle: workspace.handle }
      } else throw new Error('Reconnect the directory to restore folder access.')
      if (version !== workspaceVersion.current) return
      next = preservePreviews(next, workspace)
      scan.report({ phase: 'Saving project metadata' })
      const cached = await persist(next, true, true)
      if (cached) setNotice({ text: `Up to date. ${next.projects.length} projects synced.${next.warnings?.length ? ' Some folders could not be read; see workspace info.' : ''}` })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Sync failed. Your cached projects are still available.', error: true }) }
    finally { scan.finish(); if (version === workspaceVersion.current) setBusy('') }
  }
  async function forgetWorkspace() {
    if (busy || batches.some(batch => batch.isActive())) return
    ++workspaceVersion.current
    setBusy('disconnect')
    try { if (workspace) await stopWorkspaceServers(workspace); await clearWorkspace(); dismissBatches(); clearCriticalAlerts(); setHelperWorkspacePath(undefined); onForgotten(); setNotice({ text: 'Directory disconnected. Your files are unchanged.' }) }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Could not disconnect the workspace.', error: true }) }
    finally { setBusy('') }
  }

  return { connect, resync, forgetWorkspace, metadataProgress }
}

async function stopWorkspaceServers(current: Workspace) {
  if (current.mode !== 'helper') return
  await Promise.all(current.projects.filter(project => project.dev?.status === 'running' || project.dev?.status === 'starting').map(project => projectAction(project.id, 'stop')))
}
