// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWorkspaceConnection } from './use-workspace-connection'
import type { Workspace } from '@/types'

const api = vi.hoisted(() => ({ scanWithHelper: vi.fn(), projectAction: vi.fn(), setHelperWorkspacePath: vi.fn() }))
const storage = vi.hoisted(() => ({ clearWorkspace: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/storage', () => storage)

const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', projects: [], syncedAt: '' }
function options() {
  return {
    workspace, busy: '', path: '/next', workspaceVersion: { current: 0 },
    batches: Array.from({ length: 6 }, () => ({ isActive: vi.fn().mockReturnValue(false), dismiss: vi.fn() })),
    setBusy: vi.fn(), setConnectError: vi.fn(), setConnectOpen: vi.fn(), setHelper: vi.fn(), setNotice: vi.fn(),
    persist: vi.fn().mockResolvedValue(true), clearCriticalAlerts: vi.fn(), onConnected: vi.fn(), onForgotten: vi.fn(),
  }
}

beforeEach(() => { vi.resetAllMocks(); api.scanWithHelper.mockResolvedValue(workspace) })
afterEach(cleanup)

it.each([0, 1, 2, 3, 4, 5])('blocks directory changes while batch %i is active before busy state renders', async index => {
  const props = options()
  props.batches[index].isActive.mockReturnValue(true)
  const { result } = renderHook(() => useWorkspaceConnection(props))
  await act(async () => {
    await result.current.connect('helper')
    await result.current.resync()
    await result.current.forgetWorkspace()
  })
  expect(api.scanWithHelper).not.toHaveBeenCalled()
  expect(storage.clearWorkspace).not.toHaveBeenCalled()
  expect(props.setBusy).not.toHaveBeenCalled()
  expect(props.workspaceVersion.current).toBe(0)
})

it.each(['connect', 'resync'] as const)('discards a late %s result after the workspace generation changes', async operation => {
  let finish!: (workspace: Workspace) => void
  api.scanWithHelper.mockReturnValue(new Promise<Workspace>(resolve => { finish = resolve }))
  const props = options()
  const { result } = renderHook(() => useWorkspaceConnection(props))
  let pending!: Promise<void>
  act(() => { pending = operation === 'connect' ? result.current.connect('helper') : result.current.resync() })
  props.workspaceVersion.current++
  await act(async () => { finish(workspace); await pending })
  expect(props.persist).not.toHaveBeenCalled()
  expect(props.onConnected).not.toHaveBeenCalled()
  expect(props.setNotice).not.toHaveBeenCalled()
  expect(props.setBusy).not.toHaveBeenCalledWith('')
  expect(result.current.metadataProgress.progress).toBeUndefined()
})

it('keeps the workspace and batch results when stopping a server fails during disconnect', async () => {
  const props = options()
  props.workspace = { ...workspace, projects: [{ id: 'running', name: 'Running', dirName: 'running', relativePath: 'running', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', dev: { status: 'running' } }] }
  api.projectAction.mockRejectedValue(new Error('Could not stop the server.'))
  const { result } = renderHook(() => useWorkspaceConnection(props))
  await act(async () => { await result.current.forgetWorkspace() })
  expect(api.projectAction).toHaveBeenCalledWith('running', 'stop')
  expect(storage.clearWorkspace).not.toHaveBeenCalled()
  expect(props.onForgotten).not.toHaveBeenCalled()
  for (const batch of props.batches) expect(batch.dismiss).not.toHaveBeenCalled()
  expect(props.setNotice).toHaveBeenCalledWith({ text: 'Could not stop the server.', error: true })
  expect(props.setBusy).toHaveBeenLastCalledWith('')
})
