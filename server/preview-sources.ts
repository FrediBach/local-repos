import { normalizeGitOrigin, normalizePreviewUrl } from '../src/lib/metadata'
import type { RepoProject } from '../src/types'

export interface PreviewTarget {
  url: string
  source: 'configured' | 'package' | 'github'
}

function isOriginPage(url: string, origin: string | undefined): boolean {
  const normalizedOrigin = origin ? normalizeGitOrigin(origin) : undefined
  if (!normalizedOrigin) return false
  const candidate = new URL(url)
  const repository = new URL(normalizedOrigin)
  return candidate.hostname === repository.hostname
    && candidate.pathname.replace(/\/$/, '') === repository.pathname.replace(/\/$/, '')
}

/** Local metadata only; discovering projects never triggers a network request. */
export function getPackagePreviewTargets(project: Pick<RepoProject, 'previewUrl' | 'homepage' | 'git'>): PreviewTarget[] {
  const targets: PreviewTarget[] = []
  for (const [value, source] of [[project.previewUrl, 'configured'], [project.homepage, 'package']] as const) {
    const url = normalizePreviewUrl(value)
    if (url && !isOriginPage(url, project.git?.origin) && !targets.some((target) => target.url === url)) targets.push({ url, source })
  }
  return targets
}

async function readRepositoryMetadata(response: Response): Promise<unknown> {
  const limit = 256 * 1024
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    return undefined
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    reader.releaseLock()
  }
}

/** Resolve the public GitHub About/Website field, without tokens or gh credentials. */
export async function resolveGithubHomepage(origin: string | undefined, fetcher: typeof fetch = fetch): Promise<PreviewTarget | undefined> {
  const normalized = origin ? normalizeGitOrigin(origin) : undefined
  if (!normalized) return undefined
  const repository = new URL(normalized)
  if (repository.hostname !== 'github.com' || repository.port) return undefined
  const match = repository.pathname.match(/^\/([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]+)\/?$/i)
  if (!match || match[2] === '.' || match[2] === '..') return undefined

  try {
    const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'local-repos-preview' },
      credentials: 'omit',
      redirect: 'error',
    })
    // Private/missing repositories, rate limits and offline errors do not stop
    // the remaining preview fallbacks. Never fall back to the repository page.
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const data = await readRepositoryMetadata(response)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
    const url = normalizePreviewUrl((data as { homepage?: unknown }).homepage)
    return url && !isOriginPage(url, normalized) ? { url, source: 'github' } : undefined
  } catch {
    return undefined
  }
}
