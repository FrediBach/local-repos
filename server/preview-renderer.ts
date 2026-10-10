import { PNG } from 'pngjs'
import type { Browser, Page } from 'playwright'
import type { ScanProgressReporter } from '../src/types'
import { HelperError } from './scanner'

const CAPTURE_TIMEOUT = 25_000

/** Reject only nearly uniform images; even a small amount of text is useful. */
export function isBlankPreview(buffer: Buffer): boolean {
  const { data, width, height } = PNG.sync.read(buffer)
  const histogram = new Uint32Array(4096)
  let dominant = 0
  let dominantCount = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] / 255
    const red = Math.round(data[offset] * alpha + 255 * (1 - alpha))
    const green = Math.round(data[offset + 1] * alpha + 255 * (1 - alpha))
    const blue = Math.round(data[offset + 2] * alpha + 255 * (1 - alpha))
    const bucket = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4)
    if (++histogram[bucket] > dominantCount) {
      dominant = bucket
      dominantCount = histogram[bucket]
    }
  }
  const background = [(dominant >> 8) * 16 + 8, ((dominant >> 4) & 15) * 16 + 8, (dominant & 15) * 16 + 8]
  // A handful of contrasting pixels can be a legitimate sparse page or canvas.
  const minimumVisiblePixels = Math.min(8, Math.max(1, Math.floor(width * height / 100)))
  let visiblePixels = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] / 255
    const contrast = background.some((channel, index) => Math.abs(data[offset + index] * alpha + 255 * (1 - alpha) - channel) > 12)
    if (contrast && ++visiblePixels >= minimumVisiblePixels) return false
  }
  return true
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

async function waitForContent(page: Page, timeout: number): Promise<void> {
  // Keep browser scripts as JavaScript text: tsx otherwise injects its __name
  // helper into nested functions, which does not exist in a fresh page.
  await page.waitForFunction(String.raw`(() => {
    if (!document.body) return false
    const inViewport = (element) => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0
        && bounds.top < innerHeight && bounds.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let text
    let examined = 0
    while ((text = walker.nextNode()) && examined++ < 4000) {
      const parent = text.parentElement
      if (!text.textContent?.trim() || !parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName) || !inViewport(parent)) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      const bounds = range.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth) return true
    }
    return [...document.querySelectorAll('img, svg, canvas, video, iframe, object, embed')].some(inViewport)
  })()`, undefined, { timeout, polling: 150 }).catch((error: unknown) => {
    // CSS-only designs can still produce valid images. The pixels are the final
    // check, so a content timeout alone must not discard them.
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error
  })
}

export async function settlePage(page: Page, timeout: number): Promise<void> {
  await page.evaluate(`(async () => {
    const budget = ${Math.min(2000, timeout)}
    const visibleImages = [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect()
      return !image.complete && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight
    })
    await Promise.race([
      Promise.all([
        document.fonts.ready,
        ...visibleImages.map((image) => new Promise((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
          if (image.complete) resolve()
        })),
      ]),
      new Promise((resolve) => setTimeout(resolve, budget)),
    ])
  })()`)

  // Hydration often follows DOMContentLoaded. Allow layout mutations to settle
  // without waiting for networkidle, which dev sockets and polling can prevent.
  await page.evaluate(`new Promise((resolve) => {
    const budget = ${Math.min(2000, timeout)}
    let quiet
    let maximum
    const finish = () => {
      clearTimeout(quiet)
      clearTimeout(maximum)
      observer.disconnect()
      resolve()
    }
    const observer = new MutationObserver(() => {
      clearTimeout(quiet)
      quiet = setTimeout(finish, 500)
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    quiet = setTimeout(finish, 750)
    maximum = setTimeout(finish, budget)
  })`)
}

/** Capture a fresh, unsigned-in page, returning only a visibly rendered PNG. */
export async function capturePage(browser: Browser, input: string, onProgress?: ScanProgressReporter): Promise<Buffer> {
  let url: URL
  try {
    url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL')
  } catch {
    throw new HelperError('The preview URL must be an HTTP or HTTPS address without embedded credentials.')
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: isLoopback(url.hostname),
  })
  const diagnostics: string[] = []
  const record = (message: string) => {
    const clean = message.replace(/\s+/g, ' ').slice(0, 300)
    if (clean && !diagnostics.includes(clean) && diagnostics.length < 3) diagnostics.push(clean)
  }
  const detail = () => diagnostics.length ? ` JavaScript: ${diagnostics.join(' | ')}` : ''
  const deadline = Date.now() + CAPTURE_TIMEOUT
  const remaining = () => Math.max(1, deadline - Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const render = async () => {
      const page = await context.newPage()
      page.on('pageerror', (error) => record(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error' && !/favicon|net::ERR_ABORTED/i.test(message.text())) record(message.text())
      })
      onProgress?.({ phase: 'Loading the preview page', detail: url.href })
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(18_000, remaining()) })
      if (response && response.status() >= 400) throw new HelperError(`The preview page returned HTTP ${response.status()}.${detail()}`)
      onProgress?.({ phase: 'Waiting for visible page content', detail: url.href })
      await waitForContent(page, Math.min(12_000, Math.max(1, remaining() - 4500)))
      onProgress?.({ phase: 'Waiting for fonts, images, and layout', detail: url.href })
      await settlePage(page, Math.max(1, Math.min(2000, remaining() - 2000)))

      while (remaining() > 1) {
        const overlay = await page.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count()
        if (overlay) throw new HelperError(`The development server displayed a build error. Check the project logs.${detail()}`)
        onProgress?.({ phase: 'Capturing and checking the preview image', detail: url.href })
        const png = await page.screenshot({ fullPage: false, animations: 'disabled', timeout: Math.min(4000, remaining()) })
        if (!isBlankPreview(png)) return png
        // Canvas drawing and lazy hydration may happen after visible DOM exists.
        if (remaining() < 1200) break
        onProgress?.({ phase: 'Waiting for the blank page to finish rendering', detail: url.href })
        await page.waitForTimeout(600)
      }
      throw new HelperError(`No visible content rendered at ${url.href}. The page remained blank.${detail()}`)
    }
    return await Promise.race([
      render(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HelperError(`No usable preview rendered at ${url.href} within 25 seconds.${detail()}`)), CAPTURE_TIMEOUT)
      }),
    ])
  } catch (error) {
    if (error instanceof HelperError) throw error
    throw new HelperError(`Could not render the preview at ${url.href}: ${error instanceof Error ? error.message.split('\n')[0] : 'Browser navigation failed.'}${detail()}`)
  } finally {
    clearTimeout(timer)
    await context.close().catch(() => undefined)
  }
}
