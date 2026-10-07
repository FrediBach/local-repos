import { describe, expect, it } from 'vitest'
import { siteMetadata } from './site'

describe('public site metadata', () => {
  it('uses the custom canonical origin for social cards and crawler discovery', () => {
    const result = siteMetadata({ SITE_URL: 'https://repos.example', VERCEL_PROJECT_PRODUCTION_URL: 'fallback.vercel.app', VERCEL_ENV: 'production' }, true)
    expect(result.url).toBe('https://repos.example/')
    expect(result.indexable).toBe(true)
    expect(result.robots).toContain('Disallow: /api/')
    expect(result.robots).toContain('Sitemap: https://repos.example/sitemap.xml')
    expect(result.tags).toContainEqual({ tag: 'meta', attrs: { property: 'og:image', content: 'https://repos.example/og-image.png' } })
    expect(result.tags).toContainEqual({ tag: 'link', attrs: { rel: 'canonical', href: 'https://repos.example/' } })
  })

  it('prefers the stable Vercel production domain over a deployment URL', () => {
    expect(siteMetadata({ VERCEL_PROJECT_PRODUCTION_URL: 'repos.vercel.app', VERCEL_URL: 'repos-123.vercel.app' }, true).url).toBe('https://repos.vercel.app/')
    expect(siteMetadata({ VERCEL_URL: 'repos-123.vercel.app' }, true).url).toBe('https://repos-123.vercel.app/')
  })

  it.each(['preview', 'development', 'staging'])('keeps %s deployments out of search results even with a production URL', environment => {
    const result = siteMetadata({ SITE_URL: 'https://repos.example', VERCEL_TARGET_ENV: environment, VERCEL_ENV: 'production' }, true)
    expect(result.indexable).toBe(false)
    expect(result.robots).toBe('User-agent: *\nDisallow: /\n')
    expect(result.tags).toContainEqual({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } })
  })

  it('does not advertise a made-up public URL in a local build', () => {
    const result = siteMetadata({}, true)
    expect(result.url).toBeUndefined()
    expect(result.indexable).toBe(false)
    expect(result.robots).not.toContain('Sitemap:')
    expect(result.tags.some(tag => tag.attrs?.rel === 'canonical')).toBe(false)
    expect(siteMetadata({ SITE_URL: 'https://repos.example' }, false).indexable).toBe(false)
  })

  it.each(['not a url', 'http://repos.example', 'https://repos.example/app', 'https://repos.example/?q=1', 'https://repos.example/#section', 'https://user:secret@repos.example'])('rejects an unusable public origin: %s', url => {
    expect(() => siteMetadata({ SITE_URL: url }, true)).toThrow('SITE_URL')
  })
})
