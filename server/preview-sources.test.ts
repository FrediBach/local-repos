import { describe, expect, it, vi } from 'vitest'
import { getPackagePreviewTargets, resolveGithubHomepage } from './preview-sources'

describe('configured preview sources', () => {
  it('prioritizes the configured preview and preserves full app routes', () => {
    expect(getPackagePreviewTargets({
      previewUrl: 'https://preview.example.test/projects?theme=light#/one',
      homepage: 'https://studio.github.io/project/',
    })).toEqual([
      { url: 'https://preview.example.test/projects?theme=light#/one', source: 'configured' },
      { url: 'https://studio.github.io/project/', source: 'package' },
    ])
    expect(getPackagePreviewTargets({ previewUrl: 'https://app.example.test', homepage: 'https://app.example.test/' })).toEqual([
      { url: 'https://app.example.test/', source: 'configured' },
    ])
  })

  it('ignores invalid URLs and the origin repository page, including self-hosted Git', () => {
    expect(getPackagePreviewTargets({ previewUrl: 'javascript:alert(1)', homepage: 'https://github.com/studio/project' })).toEqual([])
    expect(getPackagePreviewTargets({
      homepage: 'https://git.example.test/team/project/#readme',
      git: { origin: 'git@git.example.test:team/project.git' },
    })).toEqual([])
  })
})

describe('GitHub project website discovery', () => {
  it.each([
    'git@github.com:studio/project.git',
    'ssh://git@github.com/studio/project.git',
    'https://github.com/studio/project.git',
    'https://user:secret@github.com/studio/project.git?token=secret',
  ])('resolves a public homepage from %s without forwarding origin credentials', async (origin) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ homepage: 'https://studio.github.io/project/app?view=grid#/welcome' }))
    expect(await resolveGithubHomepage(origin, fetcher)).toEqual({ url: 'https://studio.github.io/project/app?view=grid#/welcome', source: 'github' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/studio/project')
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(options?.headers)).not.toMatch(/secret|Authorization/i)
  })

  it.each([
    undefined, 'not-a-repo', 'javascript:alert(1)', 'file:///github.com/studio/project',
    'https://gitlab.com/studio/project', 'https://github.com.evil.test/studio/project',
    'https://github.com:1234/studio/project', 'https://github.com/studio/project/tree/main',
    'https://github.com/studio',
  ])('does not request metadata for unsupported origin %s', async (origin) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await resolveGithubHomepage(origin, fetcher)).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    undefined, null, '', 42, '/project', 'javascript:alert(1)',
    'https://username:secret@app.example.test/', 'https://github.com/studio/project',
  ])('ignores missing or unusable public homepages: %s', async (homepage) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ homepage }))
    expect(await resolveGithubHomepage('https://github.com/studio/project', fetcher)).toBeUndefined()
  })

  it.each([301, 403, 404, 429, 500])('handles unavailable GitHub metadata (%s) gracefully', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status }))
    expect(await resolveGithubHomepage('https://github.com/studio/project', fetcher)).toBeUndefined()
  })

  it('handles offline requests and malformed JSON gracefully', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Offline'))
    expect(await resolveGithubHomepage('https://github.com/studio/project', fetcher)).toBeUndefined()
    fetcher.mockResolvedValue(new Response('Not JSON'))
    expect(await resolveGithubHomepage('https://github.com/studio/project', fetcher)).toBeUndefined()
  })

  it('bounds response bodies even without content-length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ homepage: 'https://app.example.test', description: 'x'.repeat(300_000) })))
    expect(await resolveGithubHomepage('https://github.com/studio/project', fetcher)).toBeUndefined()
  })
})
