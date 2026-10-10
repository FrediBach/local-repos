import { describe, expect, it, vi } from 'vitest'
import { RemoteActivityRateLimits, scanRemoteActivity } from './remote-activity'
import type { RepoProject } from '../src/types'

const project = (origin = 'https://github.com/team/repo'): RepoProject => ({ id: 'repo', name: 'Repo', dirName: 'repo', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { origin } })
const page = (items: unknown[], headers?: HeadersInit) => new Response(JSON.stringify(items), { headers })

describe('public repository checks', () => {
  it('paginates GitHub, separates PRs, deduplicates IDs and never follows supplied links', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([{ number: 1, state: 'open' }, { number: 2, state: 'open', pull_request: {} }], { link: '<https://evil.example/secret>; rel="next"' }))
      .mockResolvedValueOnce(page([{ number: 1, state: 'open' }, { number: 3, state: 'open' }]))
    const result = await scanRemoteActivity(project('git@github.com:team/repo.git'), fetcher)
    expect(result).toMatchObject({ repository: 'https://github.com/team/repo', issues: [1, 3], pullRequests: [2] })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toBe('https://api.github.com/repos/team/repo/issues?state=open&per_page=100&page=2&sort=created&direction=asc')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/vnd.github+json' } })
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
  })

  it('encodes GitLab subgroups and requests all open issues and merge requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page([{ iid: 7, state: 'opened' }], { 'x-next-page': '2' }))
      .mockResolvedValueOnce(page([{ iid: 8, state: 'opened' }]))
      .mockResolvedValueOnce(page([{ iid: 7, state: 'opened' }]))
    expect(await scanRemoteActivity(project('https://gitlab.com/team/sub/repo.git'), fetcher)).toMatchObject({ issues: [7, 8], pullRequests: [7] })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://gitlab.com/api/v4/projects/team%2Fsub%2Frepo/issues?state=opened&per_page=100&page=1&scope=all&order_by=created_at&sort=asc',
      'https://gitlab.com/api/v4/projects/team%2Fsub%2Frepo/issues?state=opened&per_page=100&page=2&scope=all&order_by=created_at&sort=asc',
      'https://gitlab.com/api/v4/projects/team%2Fsub%2Frepo/merge_requests?state=opened&per_page=100&page=1&scope=all&order_by=created_at&sort=asc',
    ])
  })

  it.each([401, 403, 404, 429, 500])('rejects HTTP %s without reporting zero counts', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private data', { status }))
    await expect(scanRemoteActivity(project(), fetcher)).rejects.toThrow(status === 403 ? 'HTTP 403' : status === 429 ? 'rate limit' : status === 401 || status === 404 ? 'not publicly accessible' : 'HTTP 500')
  })

  it('rejects partial, malformed and oversized responses', async () => {
    for (const response of [page([{ number: '1', state: 'open' }]), page([{ number: 1, state: 'closed' }]), page([], { 'content-length': '5000000' }), new Response('{}')]) {
      await expect(scanRemoteActivity(project(), vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow()
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page([{ number: 1, state: 'open' }], { link: '<next>; rel="next"' })).mockRejectedValueOnce(new Error('network secret'))
    await expect(scanRemoteActivity(project(), fetcher)).rejects.toThrow('Previous counts were kept')
  })

  it('bounds pagination and rejects unsupported hosts before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page([{ number: 1, state: 'open' }], { link: '<next>; rel="next"' }))
    await expect(scanRemoteActivity(project(), fetcher)).rejects.toThrow('scan limit')
    expect(fetcher).toHaveBeenCalledTimes(20)
    fetcher.mockClear()
    await expect(scanRemoteActivity(project('https://gitlab.internal/team/repo'), fetcher)).rejects.toThrow('support public')
    expect(fetcher).not.toHaveBeenCalled()
  })
})


describe('public API rate limits', () => {
  const now = Date.parse('2026-10-10T17:00:00Z')
  const reset = String((now + 120_000) / 1000)

  it('identifies primary exhaustion and blocks other GitHub repositories until reset, without blocking GitLab', async () => {
    let clock = now
    const limits = new RemoteActivityRateLimits(() => clock)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'API rate limit exceeded for secret IP' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }))
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toThrow('60 requests per hour per IP address')
    await expect(scanRemoteActivity(project('https://github.com/team/other'), fetcher, undefined, undefined, limits)).rejects.toThrow('2026-10-10 17:02:01 UTC')
    expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockImplementation(async () => page([]))
    await expect(scanRemoteActivity(project('https://gitlab.com/team/repo'), fetcher, undefined, undefined, limits)).resolves.toMatchObject({ issues: [], pullRequests: [] })
    clock += 121_000
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).resolves.toMatchObject({ issues: [] })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it.each([
    [429, { 'retry-after': '90' }, {}, '17:01:31'],
    [403, { 'retry-after': 'Sat, 10 Oct 2026 17:02:00 GMT' }, {}, '17:02:01'],
    [403, {}, { message: 'You have exceeded a secondary rate limit.' }, '17:01:00'],
    [429, { 'retry-after': 'invalid', 'x-ratelimit-reset': 'Infinity' }, {}, '17:01:00'],
  ])('honors bounded secondary-limit signals for HTTP %s', async (status, headers, body, time) => {
    const limits = new RemoteActivityRateLimits(() => now)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: headers as HeadersInit }))
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toThrow(time)
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toMatchObject({ status: 429 })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps access denial separate and does not block unrelated repositories on a plain 403', async () => {
    const limits = new RemoteActivityRateLimits(() => now)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"message":"Access denied: secret"}', { status: 403 }))
      .mockResolvedValueOnce(page([]))
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toThrow('without reporting a rate limit')
    await expect(scanRemoteActivity(project('https://github.com/team/other'), fetcher, undefined, undefined, limits)).resolves.toMatchObject({ issues: [] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('accepts the last successful response and avoids an extra request for exactly 100 final items', async () => {
    const limits = new RemoteActivityRateLimits(() => now)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(page(Array.from({ length: 100 }, (_, index) => ({ number: index + 1, state: 'open' })), { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }))
    const result = await scanRemoteActivity(project(), fetcher, undefined, undefined, limits)
    expect(result.issues).toHaveLength(100)
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toThrow('rate limit')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not publish partial counts when the last available request still has another page', async () => {
    const limits = new RemoteActivityRateLimits(() => now)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(page([{ number: 1, state: 'open' }], { link: '<next>; rel="next"', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }))
    await expect(scanRemoteActivity(project(), fetcher, undefined, undefined, limits)).rejects.toThrow('Previous counts were kept')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
