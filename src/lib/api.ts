import type { RepoProject, ScanResult } from '@/types'

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.endsWith('screenshot') ? 120_000 : 60_000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || 'The local helper is unavailable. Start the app with npm run dev and try again.')
  return data as T
}
export const scanWithHelper = (path: string) => api<ScanResult>('/scan', { path })
export const projectAction = <T = Partial<RepoProject>>(id: string, action: string, body: unknown = {}) => api<T>(`/projects/${encodeURIComponent(id)}/${action}`, body)

export function originUrl(origin?: string): string | undefined {
  if (!origin) return
  const normalized = origin.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '')
  try { const url = new URL(normalized); if (url.protocol === 'https:' || url.protocol === 'http:') { url.username = ''; url.password = ''; return url.toString() } } catch { /* Not a web remote. */ }
}
