import { remoteRepository } from '../src/lib/remote-activity'
import type { RemoteActivityReport, RepoProject, ScanProgressReporter } from '../src/types'
import { HelperError } from './scanner'

const pageLimit = 20
const byteLimit = 4 * 1024 * 1024

type Provider = NonNullable<ReturnType<typeof remoteRepository>>['provider']

/** A helper-wide cooldown, shared across repositories but isolated by provider. */
export class RemoteActivityRateLimits {
  private readonly retryAt = new Map<Provider, number>()
  constructor(private readonly now: () => number = Date.now) {}

  check(provider: Provider): void {
    const retryAt = this.retryAt.get(provider)
    if (!retryAt) return
    if (retryAt <= this.now()) { this.retryAt.delete(provider); return }
    const name = provider === 'github' ? 'GitHub' : 'GitLab'
    const explanation = provider === 'github' ? ' Public GitHub API requests share a limit of 60 requests per hour per IP address, even for public repositories.' : ''
    throw new HelperError(`${name} API rate limit reached.${explanation} Repository checks are paused until ${new Date(retryAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}. Previous counts were kept.`, 429)
  }

  observe(provider: Provider, response: Response, rateLimitMessage = false): void {
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
    const retryAfter = response.headers.get('retry-after')
    const limited = response.status === 429 || (response.status === 403 && (exhausted || retryAfter !== null || rateLimitMessage))
    if (!exhausted && !limited) return
    const now = this.now()
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
    const retry = retryAfter === null ? NaN : /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter)
    const deadlines = [exhausted ? reset : NaN, retry].filter(value => Number.isFinite(value) && value > now && value <= 8.64e15 - 1000)
    const until = deadlines.length ? Math.max(...deadlines) + 1000 : now + 60_000
    this.retryAt.set(provider, Math.max(this.retryAt.get(provider) ?? 0, until))
    if (limited) this.check(provider)
  }
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new HelperError('The repository response exceeds the scan size limit.', 502)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new HelperError('The repository response exceeds the scan size limit.', 502) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function readPage(response: Response, provider: Provider, rateLimits: RemoteActivityRateLimits): Promise<unknown[]> {
  if (!response.ok) {
    // Inspect only a bounded message for classification; never display upstream bodies.
    const body = await readJson(response, 16 * 1024).catch(() => undefined)
    const message = body && typeof body === 'object' && 'message' in body ? body.message : undefined
    rateLimits.observe(provider, response, typeof message === 'string' && /(?:secondary )?rate limit|abuse detection/i.test(message))
    const name = provider === 'github' ? 'GitHub' : 'GitLab'
    throw new HelperError(response.status === 403
      ? `${name} denied this public API request (HTTP 403), without reporting a rate limit. Repository visibility alone does not guarantee API access.`
      : response.status === 404 || response.status === 401
        ? 'This repository is not publicly accessible.' : `The repository API returned HTTP ${response.status}.`, 502)
  }
  rateLimits.observe(provider, response)
  const data = await readJson(response, byteLimit)
  if (!Array.isArray(data) || data.length > 100) throw new HelperError('The repository API returned an invalid item list.', 502)
  return data
}

/** Public API reads only: no local credentials, cookies, redirects or project code. */
export async function scanRemoteActivity(project: RepoProject, fetcher: typeof fetch = fetch, onProgress?: ScanProgressReporter, signal?: AbortSignal, rateLimits = new RemoteActivityRateLimits()): Promise<RemoteActivityReport> {
  const repository = remoteRepository(project)
  if (!repository) throw new HelperError('Issue and pull request scans support public GitHub.com and GitLab.com repositories.')
  const deadline = AbortSignal.timeout(45_000)
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const issues = new Set<number>()
  const pulls = new Set<number>()
  const github = repository.provider === 'github'
  const base = github ? `https://api.github.com/repos/${repository.path}` : `https://gitlab.com/api/v4/projects/${encodeURIComponent(repository.path)}`
  // GitHub's issues endpoint includes PRs. GitLab exposes separate collections.
  const collections = github ? ['issues'] : ['issues', 'merge_requests']
  try {
    for (const collection of collections) {
      for (let page = 1; page <= pageLimit; page++) {
        onProgress?.({ phase: 'Checking issues and pull requests', detail: `${repository.path} · ${collection === 'issues' ? 'issues' : 'merge requests'} · page ${page}` })
        const url = `${base}/${collection}?state=${github ? 'open' : 'opened'}&per_page=100&page=${page}&${github ? 'sort=created&direction=asc' : 'scope=all&order_by=created_at&sort=asc'}`
        rateLimits.check(repository.provider)
        const response = await fetcher(url, { signal: boundedSignal, credentials: 'omit', redirect: 'error', headers: { Accept: github ? 'application/vnd.github+json' : 'application/json', 'User-Agent': 'local-repos' } })
        const data = await readPage(response, repository.provider, rateLimits)
        for (const item of data) {
          if (!item || typeof item !== 'object') throw new HelperError('The repository API returned an invalid item.', 502)
          const row = item as Record<string, unknown>
          const id = github ? row.number : row.iid
          if (!Number.isSafeInteger(id) || (id as number) <= 0 || row.state !== (github ? 'open' : 'opened')) throw new HelperError('The repository API returned an invalid open item.', 502)
          const target = (github ? !!row.pull_request : collection === 'merge_requests') ? pulls : issues
          target.add(id as number)
        }
        // Never follow server-provided URLs, including pagination links.
        const more = github ? /rel="next"/.test(response.headers.get('link') ?? '') : !!response.headers.get('x-next-page')
        const paginationKnown = github || response.headers.has('x-next-page')
        if (!more && (paginationKnown || data.length < 100)) break
        if (page === pageLimit) throw new HelperError('This repository exceeds the scan limit (2,000 items per collection). Previous counts were kept.', 502)
      }
    }
    return { repository: repository.url, scannedAt: new Date().toISOString(), issues: [...issues].sort((a, b) => a - b), pullRequests: [...pulls].sort((a, b) => a - b) }
  } catch (error) {
    if (error instanceof HelperError) throw error
    // Do not forward response bodies or transport errors containing request data.
    throw new HelperError('The public repository check failed or timed out. Previous counts were kept.', 502)
  }
}
