// @vitest-environment jsdom
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { chromium, type Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { discoverPreviewAssets } from './preview-assets'

const png = PNG.sync.write(new PNG({ width: 2, height: 2 }))
const temporaryDirectories: string[] = []

function browserFixture() {
  const page = {
    evaluate: vi.fn(async (script: string) => new Function('DOMParser', `return (${script})`)(DOMParser)),
  }
  const context = {
    route: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const browser = { newContext: vi.fn().mockResolvedValue(context) }
  return { browser: browser as unknown as Browser, context, page, newContext: browser.newContext }
}

function mockFetch(responses: Record<string, () => Response>) {
  const fetcher = vi.fn(async (url: string) => {
    const response = responses[url]
    if (!response) throw new Error(`Unexpected URL: ${url}`)
    return response()
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function htmlResponse(html: string) { return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) }
function pngResponse() { return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }) }

async function repository() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'local-repos-preview-assets-'))
  temporaryDirectories.push(directory)
  return directory
}

async function write(directory: string, filename: string, content: string | Buffer = png) {
  await fs.mkdir(path.dirname(path.join(directory, filename)), { recursive: true })
  await fs.writeFile(path.join(directory, filename), content)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('preview branding discovery', () => {
  it('uses the redirected page and base URL, decodes entities, and prefers OG images to logos and icons', async () => {
    const fetcher = mockFetch({
      'https://example.com/old': () => new Response(null, { status: 302, headers: { location: '/project/' } }),
      'https://example.com/project/': () => htmlResponse(`
        <base href="assets/">
        <meta content="../social.png?width=1200&amp;quality=80" property="og:image">
        <meta name=twitter:image content=twitter.png>
        <img alt="Project logo" src="brand.svg">
        <link rel="shortcut icon" href="icon.ico">
        <link href="touch.png" rel="apple-touch-icon">
        <script>throw new Error('must never execute')</script>
      `),
      'https://example.com/project/social.png?width=1200&quality=80': pngResponse,
    })
    const { browser, context, newContext } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, [{ url: 'https://example.com/old', source: 'configured' }])
    expect(candidates.map(({ kind, assetUrl }) => ({ kind, assetUrl }))).toEqual([
      { kind: 'og-image', assetUrl: 'https://example.com/project/social.png?width=1200&quality=80' },
      { kind: 'og-image', assetUrl: 'https://example.com/project/assets/twitter.png' },
      { kind: 'logo', assetUrl: 'https://example.com/project/assets/brand.svg' },
      { kind: 'favicon', assetUrl: 'https://example.com/project/assets/touch.png' },
      { kind: 'favicon', assetUrl: 'https://example.com/project/assets/icon.ico' },
      { kind: 'favicon', assetUrl: 'https://example.com/favicon.ico' },
    ])
    expect(candidates[0]).toMatchObject({ source: 'configured', url: 'https://example.com/project/' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await candidates[0].load()).toEqual({ bytes: png, mimeType: 'image/png' })
    expect(fetcher).toHaveBeenLastCalledWith(candidates[0].assetUrl, expect.objectContaining({ credentials: 'omit', redirect: 'manual' }))
    expect(newContext).toHaveBeenCalledWith({ javaScriptEnabled: false, serviceWorkers: 'block' })
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('finds local HTML branding and conventional assets while excluding dependencies and symlinks', async () => {
    const directory = await repository()
    const external = await repository()
    await Promise.all([
      write(directory, 'index.html', '<meta property="og:image" content="/share-card.png"><img class="site-logo" src="/brand.png"><link rel="icon" href="%PUBLIC_URL%/favicon.ico">'),
      write(directory, 'public/share-card.png'),
      write(directory, 'public/brand.png'),
      write(directory, 'public/favicon.ico', Buffer.from([0, 0, 1, 0, 1, 0])),
      write(directory, 'src/assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h20v20z"/></svg>'),
      write(directory, 'src/app/opengraph-image.png'),
      write(directory, 'node_modules/package/logo.png'),
      write(directory, 'dist/og-image.png'),
      write(directory, 'public/react-logo.svg', '<svg/>'),
      write(external, 'logo.png'),
    ])
    await fs.symlink(path.join(external, 'logo.png'), path.join(directory, 'public/logo-outside.png'))
    await fs.symlink(external, path.join(directory, 'public/linked-assets'))
    const fetcher = mockFetch({})
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [])
    expect(candidates.map(({ kind, assetPath }) => ({ kind, assetPath }))).toEqual([
      { kind: 'og-image', assetPath: 'public/share-card.png' },
      { kind: 'og-image', assetPath: 'src/app/opengraph-image.png' },
      { kind: 'logo', assetPath: 'public/brand.png' },
      { kind: 'logo', assetPath: 'src/assets/logo.svg' },
      { kind: 'favicon', assetPath: 'public/favicon.ico' },
    ])
    expect(candidates.every((candidate) => candidate.source === 'repository' && !candidate.assetUrl && !candidate.url)).toBe(true)
    expect(await candidates[0].load()).toEqual({ bytes: png, mimeType: 'image/png' })
    expect((await candidates[3].load())?.mimeType).toBe('image/svg+xml')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('ranks all OG images before logos and favicons, retaining source preference and removing duplicates', async () => {
    const directory = await repository()
    await write(directory, 'public/og-image.png')
    mockFetch({
      'https://first.example/': () => htmlResponse('<meta property="og:image" content="/share.png"><meta name="twitter:image" content="/share.png"><img id="logo" src="/brand.png"><link rel=icon href=/favicon.ico>'),
      'https://second.example/': () => htmlResponse('<meta property="og:image" content="/share.png">'),
    })
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [
      { url: 'https://first.example/', source: 'configured' },
      { url: 'https://second.example/', source: 'package' },
    ])
    expect(candidates.map(({ kind, source }) => [kind, source])).toEqual([
      ['og-image', 'configured'], ['og-image', 'package'], ['og-image', 'repository'],
      ['logo', 'configured'], ['favicon', 'configured'], ['favicon', 'package'],
    ])
  })

  it('rejects non-web URLs, embedded credentials, and unsafe redirects before making a request', async () => {
    const fetcher = mockFetch({
      'https://example.com/': () => htmlResponse('<meta property="og:image" content="file:///tmp/private.png"><img alt="logo" src="https://user:secret@example.com/logo.png"><link rel=icon href="javascript:alert(1)">'),
      'https://example.com/favicon.ico': () => new Response(null, { status: 302, headers: { location: 'https://user:secret@example.com/private.png' } }),
    })
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, [
      { url: 'file:///tmp/index.html', source: 'configured' },
      { url: 'https://user:secret@example.com/', source: 'package' },
      { url: 'https://example.com/', source: 'github' },
    ])
    expect(candidates).toHaveLength(1)
    expect(await candidates[0].load()).toBeUndefined()
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://example.com/', 'https://example.com/favicon.ico'])
  })

  it('still tries a site favicon after page fetching fails', async () => {
    mockFetch({ 'https://offline.example/favicon.ico': pngResponse })
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, [{ url: 'https://offline.example/project', source: 'configured' }])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].assetUrl).toBe('https://offline.example/favicon.ico')
    expect(await candidates[0].load()).toEqual({ bytes: png, mimeType: 'image/png' })
  })

  it.each([
    ['HTML with an image content type', () => new Response('<html>Not an image</html>', { headers: { 'content-type': 'image/png' } })],
    ['images served as HTML', () => new Response(new Uint8Array(png), { headers: { 'content-type': 'text/html' } })],
    ['oversized declared payloads', () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'content-length': String(4 * 1024 * 1024 + 1) } })],
    ['oversized streamed payloads', () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })],
    ['HTTP errors', () => new Response(null, { status: 404 })],
  ] as const)('rejects %s and leaves later candidates available', async (_name, response) => {
    mockFetch({
      'https://example.com/': () => htmlResponse('<meta property="og:image" content="/share.png"><img alt=logo src=/logo.png>'),
      'https://example.com/share.png': response,
      'https://example.com/logo.png': pngResponse,
    })
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, [{ url: 'https://example.com/', source: 'configured' }])
    expect(await candidates[0].load()).toBeUndefined()
    expect(await candidates[1].load()).toEqual({ bytes: png, mimeType: 'image/png' })
  })

  it('does not read oversized HTML metadata', async () => {
    mockFetch({ 'https://example.com/': () => new Response('<meta property="og:image" content="/share.png">', { headers: { 'content-type': 'text/html', 'content-length': String(1024 * 1024 + 1) } }) })
    const { browser, page } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, [{ url: 'https://example.com/', source: 'configured' }])
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['favicon'])
  })

  it('rejects repository files replaced with symlinks after discovery', async () => {
    const directory = await repository()
    const external = await repository()
    await write(directory, 'public/logo.png')
    await write(external, 'private.png')
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [])
    await fs.unlink(path.join(directory, 'public/logo.png'))
    await fs.symlink(path.join(external, 'private.png'), path.join(directory, 'public/logo.png'))
    expect(await candidates[0].load()).toBeUndefined()
  })

  it('rejects a repository root replaced with a symlink after discovery', async () => {
    const directory = await repository()
    const external = await repository()
    await write(directory, 'logo.png')
    await write(external, 'logo.png')
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [])
    const original = `${directory}-original`
    temporaryDirectories.push(original)
    await fs.rename(directory, original)
    await fs.symlink(external, directory)
    expect(await candidates[0].load()).toBeUndefined()
  })

  it('ignores oversized repository HTML and images', async () => {
    const directory = await repository()
    await write(directory, 'index.html', Buffer.alloc(1024 * 1024 + 1))
    await write(directory, 'public/logo.png', Buffer.alloc(4 * 1024 * 1024 + 1))
    const { browser, page } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [])
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(candidates).toHaveLength(1)
    expect(await candidates[0].load()).toBeUndefined()
  })

  it('preserves provenance for externally hosted images declared by a repository HTML file', async () => {
    const directory = await repository()
    await write(directory, 'index.html', '<meta property="og:image" content="//cdn.example.com/share.png">')
    mockFetch({ 'https://cdn.example.com/share.png': pngResponse })
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, directory, [])
    expect(candidates[0]).toMatchObject({ kind: 'og-image', source: 'repository', assetPath: 'index.html', assetUrl: 'https://cdn.example.com/share.png' })
    expect(await candidates[0].load()).toEqual({ bytes: png, mimeType: 'image/png' })
  })

  it('bounds page and candidate discovery', async () => {
    const fetcher = vi.fn(async () => htmlResponse(Array.from({ length: 30 }, (_, index) => `<meta property="og:image" content="/share-${index}.png"><img alt=logo src=/logo-${index}.png><link rel=icon href=/icon-${index}.png>`).join('')))
    vi.stubGlobal('fetch', fetcher)
    const { browser } = browserFixture()
    const candidates = await discoverPreviewAssets(browser, undefined, Array.from({ length: 8 }, (_, index) => ({ url: `https://example${index}.com/`, source: 'configured' as const })))
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(candidates).toHaveLength(18)
    expect(candidates.filter((candidate) => candidate.kind === 'favicon')).toHaveLength(6)
  })
})

describe.skipIf(!existsSync(chromium.executablePath()))('preview metadata parsing in Chromium', () => {
  let browser: Browser
  beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 15_000)
  afterAll(async () => { await browser?.close() })

  it('parses inert HTML using the real browser evaluation API', async () => {
    mockFetch({
      'https://example.com/': () => htmlResponse('<meta property="og:image" content="/social.png?x=1&amp;y=2"><img alt="Project logo" src="/brand.png"><script>location.href="https://unexpected.example"</script>'),
    })
    const candidates = await discoverPreviewAssets(browser, undefined, [{ url: 'https://example.com/', source: 'configured' }])
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['og-image', 'logo', 'favicon'])
    expect(candidates[0].assetUrl).toBe('https://example.com/social.png?x=1&y=2')
    expect(browser.contexts()).toHaveLength(0)
  })
})
