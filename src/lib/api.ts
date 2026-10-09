import type { GitDay, GitDayQuery, GitHistory, GitHistoryQuery, GitPushStatus, RepoProject, ScanResult } from '@/types'

let helperWorkspacePath: string | undefined
let registration: { path: string; promise: Promise<ScanResult> } | undefined
export function setHelperWorkspacePath(path?: string) { helperWorkspacePath = path }

export async function api<T>(path: string, body?: unknown, retry = true): Promise<T> {
  const root = helperWorkspacePath
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.endsWith('test-coverage') ? 480_000 : path.endsWith('update-packages') ? 420_000 : path.endsWith('screenshot') ? 240_000 : /(?:audit|outdated|unused|react-doctor|delete-node-modules)$/.test(path) ? 150_000 : 60_000),
  })
  const data = await response.json().catch(() => null)
  // Manual mode restores cached browsing without scanning on startup. Register
  // lazily if a user opens history or invokes an action after a helper restart.
  // Background status polling must never initiate this scan.
  if (!response.ok && response.status === 404 && data?.error === 'Project not found. Sync its folder again.' && retry && root && path.startsWith('/projects/') && !path.endsWith('/status')) {
    if (helperWorkspacePath !== root) throw new Error('The connected directory changed. Try the action again.')
    if (!registration || registration.path !== root) registration = { path: root, promise: scanWithHelper(root) }
    const pending = registration
    try { await pending.promise } finally { if (registration === pending) registration = undefined }
    if (helperWorkspacePath !== root) throw new Error('The connected directory changed. Try the action again.')
    return api<T>(path, body, false)
  }
  if (!response.ok) throw new Error(data?.error || 'The local helper is unavailable. Start the app with npm run dev and try again.')
  return data as T
}
export const scanWithHelper = (path: string) => api<ScanResult>('/scan', { path })
export const projectAction = <T = Partial<RepoProject>>(id: string, action: string, body: unknown = {}) => api<T>(`/projects/${encodeURIComponent(id)}/${action}`, body)
export const projectHistory = (id: string, query: GitHistoryQuery = {}) => projectAction<GitHistory>(id, 'history', query)
export const projectDay = (id: string, query: GitDayQuery) => projectAction<GitDay>(id, 'daily-summary', query)
export const projectPushStatus = (id: string) => projectAction<GitPushStatus>(id, 'push-status')

export function originUrl(origin?: string): string | undefined {
  if (!origin) return
  const normalized = origin.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '')
  try { const url = new URL(normalized); if (url.protocol === 'https:' || url.protocol === 'http:') { url.username = ''; url.password = ''; return url.toString() } } catch { /* Not a web remote. */ }
}
