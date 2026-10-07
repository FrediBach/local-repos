import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { Browser } from 'playwright'

export interface PreviewAssetCandidate {
  kind: 'og-image' | 'logo' | 'favicon'
  source: 'local' | 'configured' | 'package' | 'github' | 'repository'
  /** The page that supplied the image, when available. */
  url?: string
  assetUrl?: string
  /** Repository-relative paths only; never expose a file URL. */
  assetPath?: string
  load: () => Promise<{ bytes: Buffer; mimeType: string } | undefined>
}

interface PreviewAssetTarget {
  url: string
  source: 'local' | 'configured' | 'package' | 'github'
}

interface ImageReference { kind: PreviewAssetCandidate['kind']; value: string }
interface ParsedMetadata { base?: string; images: ImageReference[] }

const IMAGE_LIMIT = 4 * 1024 * 1024
const HTML_LIMIT = 1024 * 1024
const MAX_CANDIDATES = 18
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i
const KIND_ORDER = { 'og-image': 0, logo: 1, favicon: 2 }

function webUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

async function readLimited(response: Response, limit: number): Promise<Buffer | undefined> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    return undefined
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    reader.releaseLock()
  }
}

/** A fresh unauthenticated request, validating every redirect before following it. */
async function download(input: string, limit: number, accept: string): Promise<{ bytes: Buffer; url: string; contentType: string } | undefined> {
  let url = webUrl(input)
  if (!url) return undefined
  const signal = AbortSignal.timeout(4000)
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response: Response = await fetch(url, {
        redirect: 'manual', credentials: 'omit', signal,
        headers: { Accept: accept, 'User-Agent': 'local-repos-preview' },
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location: string | null = response.headers.get('location')
        url = location ? webUrl(location, url) : undefined
        if (!url) return undefined
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        return undefined
      }
      const bytes = await readLimited(response, limit)
      return bytes?.length ? { bytes, url, contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '' } : undefined
    }
  } catch {
    // Offline sites and invalid images must not stop later fallback candidates.
  }
  return undefined
}

/** Check the actual format instead of trusting a filename or Content-Type header. */
function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon'
  if (bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp'
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 64))) return 'image/avif'
  if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)))) return 'image/svg+xml'
  return undefined
}

function remoteCandidate(reference: ImageReference, assetUrl: string, source: PreviewAssetCandidate['source'], url?: string): PreviewAssetCandidate {
  return {
    kind: reference.kind, source, url, assetUrl,
    load: async () => {
      const result = await download(assetUrl, IMAGE_LIMIT, 'image/*')
      if (!result || (result.contentType && !result.contentType.startsWith('image/') && !['application/octet-stream', 'binary/octet-stream'].includes(result.contentType))) return undefined
      const mimeType = imageMime(result.bytes)
      return mimeType ? { bytes: result.bytes, mimeType } : undefined
    },
  }
}

function namedKind(filename: string): PreviewAssetCandidate['kind'] | undefined {
  if (!IMAGE_EXTENSION.test(filename) || /^(?:vite|react|next|vercel|svelte|astro|nuxt)(?:[-_]logo)?\./i.test(filename)) return undefined
  if (/(?:^|[._-])(?:og(?:[-_]?image)?|open[-_]?graph(?:[-_]?image)?|social|share)(?:[._-]|$)/i.test(filename)) return 'og-image'
  if (/(?:^|[._-])(?:logo|logotype|brandmark|wordmark)(?:[._-]|$)/i.test(filename)) return 'logo'
  if (/^(?:favicon(?:[._-]|$)|apple-touch-icon|icon(?:[._-]|\d|$))/i.test(filename)) return 'favicon'
  return undefined
}

interface RepositoryFiles { root: string; images: string[]; html: { filename: string; html: string }[] }

async function readRepositoryFile(root: string, filename: string, limit: number): Promise<Buffer | undefined> {
  try {
    if (await fs.realpath(root) !== root || (await fs.lstat(root)).isSymbolicLink()) return undefined
    let current = root
    for (const component of filename.split(path.sep)) {
      if (!component || component === '.' || component === '..') return undefined
      current = path.join(current, component)
      if ((await fs.lstat(current)).isSymbolicLink()) return undefined
    }
    const resolved = await fs.realpath(current)
    if (!resolved.startsWith(`${root}${path.sep}`)) return undefined
    const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > limit || !stat.size) return undefined
      // Recheck after opening, then read at most limit + 1 bytes even if the file grows.
      if (await fs.realpath(root) !== root || await fs.realpath(current) !== resolved) return undefined
      const bytes = Buffer.alloc(limit + 1)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      return offset <= limit ? Buffer.from(bytes.subarray(0, offset)) : undefined
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

async function repositoryFiles(directory: string | undefined): Promise<RepositoryFiles | undefined> {
  if (!directory) return undefined
  try {
    const root = await fs.realpath(directory)
    const images: string[] = []
    const html: RepositoryFiles['html'] = []
    const queue = [{ relative: '', depth: 0 }]
    let examined = 0
    const roots = new Set(['public', 'static', 'assets', 'images', 'img', 'icons', 'src', 'app'])
    const excluded = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'coverage', 'vendor'])
    while (queue.length && examined < 1600) {
      const current = queue.shift()!
      const entries = await fs.readdir(path.join(root, current.relative), { withFileTypes: true }).catch(() => [])
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (++examined > 1600) break
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded.has(entry.name)) continue
        const relative = path.join(current.relative, entry.name)
        if (entry.isDirectory()) {
          if (current.depth >= 4 || (current.depth === 0 && !roots.has(entry.name))) continue
          // Avoid crawling all application source; images usually live in these folders.
          if (current.relative === 'src' && !roots.has(entry.name)) continue
          queue.push({ relative, depth: current.depth + 1 })
        } else if (entry.isFile()) {
          if (IMAGE_EXTENSION.test(entry.name)) images.push(relative)
          if (/^index\.html?$/i.test(entry.name) && html.length < 4) {
            const bytes = await readRepositoryFile(root, relative, HTML_LIMIT)
            if (bytes) html.push({ filename: relative, html: bytes.toString('utf8') })
          }
        }
      }
    }
    return { root, images, html }
  } catch {
    return undefined
  }
}

function localCandidate(files: RepositoryFiles, filename: string, kind: PreviewAssetCandidate['kind']): PreviewAssetCandidate {
  return {
    kind, source: 'repository', assetPath: filename.split(path.sep).join('/'),
    load: async () => {
      const bytes = await readRepositoryFile(files.root, filename, IMAGE_LIMIT)
      const mimeType = bytes ? imageMime(bytes) : undefined
      return bytes && mimeType ? { bytes, mimeType } : undefined
    },
  }
}

function localReference(files: RepositoryFiles, htmlFile: string, reference: ImageReference, base?: string): PreviewAssetCandidate | undefined {
  const value = reference.value.replace(/^%PUBLIC_URL%/, '')
  const remoteBase = base ? webUrl(base, base.startsWith('//') ? 'https://repository.invalid/' : undefined) : undefined
  const remote = webUrl(value, remoteBase ?? (value.startsWith('//') ? 'https://repository.invalid/' : undefined))
  if (remote) return { ...remoteCandidate(reference, remote, 'repository'), assetPath: htmlFile.split(path.sep).join('/') }
  // A synthetic URL gives browser-compatible path resolution without allowing file URLs.
  let pathname: string
  try {
    const documentUrl = new URL(htmlFile.split(path.sep).join('/'), 'https://repository.invalid/')
    const baseUrl = base ? new URL(base, documentUrl) : documentUrl
    const resolved = new URL(value, baseUrl)
    if (resolved.origin !== documentUrl.origin || resolved.username || resolved.password) return undefined
    pathname = decodeURIComponent(resolved.pathname).replace(/^\/+/, '')
    if (pathname.includes('\0') || pathname.includes('\\')) return undefined
  } catch {
    return undefined
  }
  const options = [pathname, path.join('public', pathname), path.join('static', pathname)]
  const filename = options.find((option) => files.images.includes(option))
  return filename ? localCandidate(files, filename, reference.kind) : undefined
}

// DOMParser decodes entities and handles quoted/unquoted attributes. The document
// stays detached, scripts never run, and the parsing context blocks all network.
const PARSE_METADATA = String.raw`(html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = []
  const add = (kind, value) => { if (value?.trim() && images.filter((image) => image.kind === kind).length < 3) images.push({ kind, value: value.trim() }) }
  const metadata = [...doc.querySelectorAll('meta')]
  for (const name of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    for (const meta of metadata) if ((meta.getAttribute('property') || meta.getAttribute('name') || '').toLowerCase() === name) add('og-image', meta.getAttribute('content'))
  }
  for (const img of [...doc.querySelectorAll('img')].slice(0, 500)) {
    const src = img.getAttribute('src') || img.getAttribute('data-src')
    const filename = (src || '').split(/[?#]/)[0].split('/').pop()
    const identity = [img.getAttribute('alt'), img.id, img.className, filename].join(' ')
    if (/(?:^|[\s_.-])(?:logo|logotype|brandmark|wordmark)(?:[\s_.-]|$)/i.test(identity) && !/^(?:vite|react|next|vercel|svelte|astro|nuxt)(?:[-_]logo)?\.svg$/i.test(filename)) add('logo', src)
  }
  const links = [...doc.querySelectorAll('link')]
  for (const link of links) if (/apple-touch-icon/i.test(link.getAttribute('rel') || '')) add('favicon', link.getAttribute('href'))
  for (const link of links) if (/(?:^|\s)icon(?:\s|$)/i.test(link.getAttribute('rel') || '')) add('favicon', link.getAttribute('href'))
  return { base: doc.querySelector('base[href]')?.getAttribute('href') || undefined, images }
}`

/** Discover branding only after page captures fail; image downloads remain lazy. */
export async function discoverPreviewAssets(browser: Browser, directory: string | undefined, targets: PreviewAssetTarget[]): Promise<PreviewAssetCandidate[]> {
  const uniqueTargets = targets.filter((target, index) => webUrl(target.url) && targets.findIndex((other) => other.url === target.url) === index).slice(0, 4)
  const [pages, files] = await Promise.all([
    Promise.all(uniqueTargets.map(async (target) => ({ target, response: await download(target.url, HTML_LIMIT, 'text/html,application/xhtml+xml') }))),
    repositoryFiles(directory),
  ])
  const candidates: PreviewAssetCandidate[] = []
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' })
  try {
    await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    for (const { target, response } of pages) {
      const pageUrl = response?.url ?? target.url
      if (response && (!response.contentType || ['text/html', 'application/xhtml+xml'].includes(response.contentType))) {
        const metadata = await page.evaluate<ParsedMetadata>(`(${PARSE_METADATA})(${JSON.stringify(response.bytes.toString('utf8'))})`).catch(() => undefined)
        const base = metadata?.base ? webUrl(metadata.base, pageUrl) ?? pageUrl : pageUrl
        for (const reference of metadata?.images ?? []) {
          const assetUrl = webUrl(reference.value, base)
          if (assetUrl) candidates.push(remoteCandidate(reference, assetUrl, target.source, pageUrl))
        }
      }
      const favicon = webUrl('/favicon.ico', pageUrl)
      if (favicon) candidates.push(remoteCandidate({ kind: 'favicon', value: favicon }, favicon, target.source, pageUrl))
    }
    if (files) {
      for (const html of files.html) {
        const metadata = await page.evaluate<ParsedMetadata>(`(${PARSE_METADATA})(${JSON.stringify(html.html)})`).catch(() => undefined)
        for (const reference of metadata?.images ?? []) {
          const candidate = localReference(files, html.filename, reference, metadata?.base)
          if (candidate) candidates.push(candidate)
        }
      }
    }
  } finally {
    await context.close().catch(() => undefined)
  }
  if (files) {
    for (const filename of files.images) {
      const kind = namedKind(path.basename(filename))
      if (kind) candidates.push(localCandidate(files, filename, kind))
    }
  }
  candidates.sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind])
  const seen = new Set<string>()
  const counts = { 'og-image': 0, logo: 0, favicon: 0 }
  return candidates.filter((candidate) => {
    const key = candidate.assetUrl ?? candidate.assetPath!
    // Reserve space for every kind: many OG tags must not crowd out favicon fallbacks.
    if (seen.has(key) || counts[candidate.kind] >= MAX_CANDIDATES / 3) return false
    seen.add(key)
    counts[candidate.kind]++
    return true
  }).slice(0, MAX_CANDIDATES)
}
