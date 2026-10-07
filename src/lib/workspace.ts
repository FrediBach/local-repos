import type { Workspace } from '@/types'

/** Keep durable previews and dated maintenance results across helper restarts. */
export function preservePreviews(next: Workspace, previous?: Workspace): Workspace {
  if (!previous) return next
  const saved = new Map(previous.projects.map(project => [project.id, project]))
  return { ...next, projects: next.projects.map(project => {
    const cached = saved.get(project.id)
    if (!cached) return project
    return {
      ...project,
      ...(cached.screenshot?.startsWith('data:image/png;base64,') ? { screenshot: cached.screenshot, preview: cached.preview } : {}),
      ...(project.storage === undefined && cached.storage ? { storage: cached.storage } : {}),
      ...(project.audit === undefined && cached.audit ? { audit: cached.audit } : {}),
      ...(project.outdated === undefined && cached.outdated ? { outdated: cached.outdated } : {}),
    }
  }) }
}

export async function cachePreview(url: string): Promise<string> {
  if (!url.startsWith('/api/screenshots/')) throw new Error('Unexpected preview location.')
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('The preview was captured but could not be loaded. Please capture it again.')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The preview could not be saved in this browser.'))
    reader.readAsDataURL(blob)
  })
}
