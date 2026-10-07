import type { Workspace } from '@/types'

/** Keep captured images available after the helper's temporary files expire. */
export function preservePreviews(next: Workspace, previous?: Workspace): Workspace {
  if (!previous) return next
  const images = new Map(previous.projects.filter(project => project.screenshot?.startsWith('data:image/png;base64,')).map(project => [project.id, project.screenshot]))
  return { ...next, projects: next.projects.map(project => images.has(project.id) ? { ...project, screenshot: images.get(project.id) } : project) }
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
