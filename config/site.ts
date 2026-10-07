import type { HtmlTagDescriptor, Plugin } from 'vite'

export const site = {
  name: 'Local Repos',
  title: 'Local Repos — A place for your projects',
  description: 'Bring your local repositories together. Browse READMEs, search packages, track Git activity, and pick up where you left off.',
  themeColor: '#f8f9f5',
}

type Environment = Record<string, string | undefined>

export function siteMetadata(env: Environment, building: boolean) {
  const domain = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
  const configuredUrl = env.SITE_URL?.trim() || (domain ? `https://${domain}` : undefined)
  let url: string | undefined
  if (configuredUrl) {
    let parsed: URL
    try { parsed = new URL(configuredUrl) } catch { throw new Error('SITE_URL must be an absolute HTTPS URL.') }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('SITE_URL must be an HTTPS origin without credentials, a path, query, or hash. This app is served at the domain root.')
    }
    url = parsed.href
  }
  const environment = env.VERCEL_TARGET_ENV || env.VERCEL_ENV
  const indexable = building && !!url && (!environment || environment === 'production')
  const robots = indexable
    ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${url}sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
  const tags: HtmlTagDescriptor[] = [
    { tag: 'title', children: site.title },
    { tag: 'meta', attrs: { name: 'description', content: site.description } },
    { tag: 'meta', attrs: { name: 'application-name', content: site.name } },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: site.name } },
    { tag: 'meta', attrs: { name: 'robots', content: indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' } },
    ...Object.entries({
      'og:type': 'website', 'og:locale': 'en_US', 'og:site_name': site.name,
      'og:title': site.title, 'og:description': site.description,
      'og:image:width': '1200', 'og:image:height': '630', 'og:image:type': 'image/png',
      'og:image:alt': 'Local Repos — A place for your projects. Less looking. More making.',
    }).map(([property, content]) => ({ tag: 'meta', attrs: { property, content } })),
    ...Object.entries({
      'twitter:card': 'summary_large_image', 'twitter:title': site.title,
      'twitter:description': site.description,
      'twitter:image:alt': 'Local Repos — A place for your projects. Less looking. More making.',
    }).map(([name, content]) => ({ tag: 'meta', attrs: { name, content } })),
  ]
  if (url) {
    tags.push(
      { tag: 'link', attrs: { rel: 'canonical', href: url } },
      { tag: 'meta', attrs: { property: 'og:url', content: url } },
      { tag: 'meta', attrs: { property: 'og:image', content: `${url}og-image.png` } },
      { tag: 'meta', attrs: { name: 'twitter:image', content: `${url}og-image.png` } },
      { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'WebApplication', name: site.name,
        url, description: site.description, image: `${url}og-image.png`,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Web',
        isAccessibleForFree: true,
      }).replace(/</g, '\\u003c') },
    )
  }
  return { url, indexable, robots, tags }
}

export function siteMetadataPlugin(env: Environment, building: boolean): Plugin {
  const metadata = siteMetadata(env, building)
  return {
    name: 'local-repos-site-metadata',
    // Append after the charset declaration, which must remain within the first 1024 bytes.
    transformIndexHtml: () => metadata.tags.map(tag => ({ ...tag, injectTo: 'head' })),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: metadata.robots })
      if (metadata.indexable) {
        const url = metadata.url!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url}</loc></url></urlset>\n` })
      }
    },
  }
}
