import type { GitDay, GitDayQuery, GitHistory, GitHistoryQuery, GitPushStatus, RepoProject, ScanProgressReporter, ScanResult } from '@/types'

let helperWorkspacePath: string | undefined
let registration: { path: string; promise: Promise<ScanResult> } | undefined
export function setHelperWorkspacePath(path?: string) { helperWorkspacePath = path }

class HelperError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// Reports can contain cached preview images. Bound a single frame generously,
// while processing progress immediately without accumulating the whole stream.
const MAX_FRAME_SIZE = 32 * 1024 * 1024

async function readProgress<T>(response: Response, onProgress?: ScanProgressReporter): Promise<T> {
  if (!response.body) throw new Error('The helper returned an empty scan stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let result: T | undefined
  let receivedResult = false
  function frame(line: string) {
    if (!line.trim()) return
    if (line.length > MAX_FRAME_SIZE) throw new Error('The helper scan response exceeded its size limit.')
    let data: { type?: string; progress?: { phase?: unknown; detail?: unknown; completed?: unknown; total?: unknown }; result?: T; error?: string; status?: number }
    try { data = JSON.parse(line) } catch { throw new Error('The helper returned an invalid scan response.') }
    if (!data || typeof data !== 'object' || receivedResult) throw new Error('The helper returned an invalid scan response.')
    if (data.type === 'error') throw new HelperError(typeof data.error === 'string' ? data.error : 'The scan failed.', typeof data.status === 'number' ? data.status : 500)
    if (data.type === 'result' && 'result' in data) { result = data.result; receivedResult = true; return }
    const progress = data.progress
    if (data.type !== 'progress' || !progress || typeof progress.phase !== 'string') throw new Error('The helper returned an invalid scan response.')
    onProgress?.({
      phase: progress.phase,
      ...(typeof progress.detail === 'string' ? { detail: progress.detail } : {}),
      ...(typeof progress.completed === 'number' && Number.isFinite(progress.completed) && progress.completed >= 0 ? { completed: progress.completed } : {}),
      ...(typeof progress.total === 'number' && Number.isFinite(progress.total) && progress.total >= 0 ? { total: progress.total } : {}),
    })
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = pending.indexOf('\n')) !== -1) {
        frame(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (pending.length > MAX_FRAME_SIZE) throw new Error('The helper scan response exceeded its size limit.')
      if (done) break
    }
    if (pending.trim()) frame(pending)
    if (!receivedResult) throw new Error('The helper disconnected before the scan completed. Try the scan again.')
    return result as T
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function api<T>(path: string, body?: unknown, retry = true, onProgress?: ScanProgressReporter): Promise<T> {
  const root = helperWorkspacePath
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1', ...(onProgress ? { Accept: 'application/x-ndjson' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.endsWith('fix-vulnerability') ? 540_000 : path.endsWith('update-packages') ? 420_000 : /(?:screenshot|lighthouse)$/.test(path) ? 240_000 : /(?:audit|outdated|unused|react-doctor|delete-node-modules)$/.test(path) ? 150_000 : 60_000),
  })
  let data: T
  let failure: HelperError | undefined
  try {
    if (response.ok && response.headers?.get('Content-Type')?.includes('application/x-ndjson')) data = await readProgress<T>(response, onProgress)
    else {
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new HelperError(value?.error || 'The local helper is unavailable. Start the app with npm run dev and try again.', response.status)
      data = value as T
    }
  } catch (error) {
    if (!(error instanceof HelperError)) throw error
    failure = error
  }
  // Manual mode restores cached browsing without scanning on startup. Register
  // lazily if a user opens history or invokes an action after a helper restart.
  // Background status polling must never initiate this scan.
  if (failure?.status === 404 && failure.message === 'Project not found. Sync its folder again.' && retry && root && path.startsWith('/projects/') && !path.endsWith('/status')) {
    if (helperWorkspacePath !== root) throw new Error('The connected directory changed. Try the action again.')
    onProgress?.({ phase: 'Reconnecting to the workspace', detail: 'Restoring the helper’s project registrations before retrying this scan.' })
    if (!registration || registration.path !== root) registration = { path: root, promise: scanWithHelper(root, onProgress) }
    const pending = registration
    try { await pending.promise } finally { if (registration === pending) registration = undefined }
    if (helperWorkspacePath !== root) throw new Error('The connected directory changed. Try the action again.')
    return api<T>(path, body, false, onProgress)
  }
  if (failure) throw failure
  return data!
}
export const scanWithHelper = (path: string, onProgress?: ScanProgressReporter) => api<ScanResult>('/scan', { path }, true, onProgress)
export const projectAction = <T = Partial<RepoProject>>(id: string, action: string, body: unknown = {}, onProgress?: ScanProgressReporter) => api<T>(`/projects/${encodeURIComponent(id)}/${action}`, body, true, onProgress)
export const projectHistory = (id: string, query: GitHistoryQuery = {}) => projectAction<GitHistory>(id, 'history', query)
export const projectDay = (id: string, query: GitDayQuery) => projectAction<GitDay>(id, 'daily-summary', query)
export const projectPushStatus = (id: string) => projectAction<GitPushStatus>(id, 'push-status')

export function originUrl(origin?: string): string | undefined {
  if (!origin) return
  const normalized = origin.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '')
  try { const url = new URL(normalized); if (url.protocol === 'https:' || url.protocol === 'http:') { url.username = ''; url.password = ''; return url.toString() } } catch { /* Not a web remote. */ }
}
