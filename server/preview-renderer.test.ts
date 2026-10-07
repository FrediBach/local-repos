import { PNG } from 'pngjs'
import type { Browser } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { capturePage, isBlankPreview } from './preview-renderer'

function fixture(color: [number, number, number, number], draw?: (png: PNG) => void): Buffer {
  const png = new PNG({ width: 1440, height: 900 })
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(color, offset)
  draw?.(png)
  return PNG.sync.write(png)
}

describe('blank preview detection', () => {
  it.each<[string, [number, number, number, number]]>([
    ['white', [255, 255, 255, 255]],
    ['black', [0, 0, 0, 255]],
    ['colored', [50, 120, 200, 255]],
    ['transparent', [0, 0, 0, 0]],
  ])('rejects uniform %s images', (_name, color) => {
    expect(isBlankPreview(fixture(color))).toBe(true)
  })

  it('rejects almost-white backgrounds with tiny color variations', () => {
    expect(isBlankPreview(fixture([255, 255, 255, 255], (png) => {
      for (let offset = 0; offset < png.data.length; offset += 8) png.data.set([249, 249, 250, 255], offset)
    }))).toBe(true)
  })

  it('accepts very sparse text or canvas marks without coarse sampling', () => {
    expect(isBlankPreview(fixture([255, 255, 255, 255], (png) => {
      for (let index = 0; index < 12; index++) png.data.set([10, 10, 10, 255], (1440 * 103 + 137 + index) * 4)
    }))).toBe(false)
  })

  it('preserves sparse light-gray text', () => {
    expect(isBlankPreview(fixture([255, 255, 255, 255], (png) => {
      for (let index = 0; index < 12; index++) png.data.set([230, 230, 230, 255], (1440 * 103 + 137 + index) * 4)
    }))).toBe(false)
  })

  it('accepts colored blocks on a dark page', () => {
    expect(isBlankPreview(fixture([0, 0, 0, 255], (png) => {
      for (let y = 350; y < 360; y++) {
        for (let x = 500; x < 510; x++) png.data.set([30, 110, 200, 255], (1440 * y + x) * 4)
      }
    }))).toBe(false)
  })
})

describe('preview browser isolation', () => {
  function browserFixture(status = 200) {
    const png = fixture([255, 255, 255, 255], (image) => {
      for (let x = 10; x < 50; x++) image.data.set([0, 0, 0, 255], (1440 * 10 + x) * 4)
    })
    const page = {
      on: vi.fn(),
      goto: vi.fn().mockResolvedValue({ status: () => status }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      screenshot: vi.fn().mockResolvedValue(png),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    }
    const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
    const browser = { newContext: vi.fn().mockResolvedValue(context) }
    return { page, context, browser, png }
  }

  it('preserves paths and hashes, validates external TLS, and closes its context', async () => {
    const { browser, page, context, png } = browserFixture()
    expect(await capturePage(browser as unknown as Browser, 'https://example.com/project/#demo')).toEqual(png)
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ ignoreHTTPSErrors: false }))
    expect(page.goto).toHaveBeenCalledWith('https://example.com/project/#demo', expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('permits a local development certificate', async () => {
    const { browser } = browserFixture()
    await capturePage(browser as unknown as Browser, 'https://127.0.0.1:4321')
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ ignoreHTTPSErrors: true }))
  })

  it('rejects HTTP error pages and closes the context', async () => {
    const { browser, context, page } = browserFixture(503)
    await expect(capturePage(browser as unknown as Browser, 'https://example.com')).rejects.toThrow('HTTP 503')
    expect(page.screenshot).not.toHaveBeenCalled()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('retries blank canvas frames until pixels have rendered', async () => {
    const { browser, page, png } = browserFixture()
    page.screenshot.mockResolvedValueOnce(fixture([255, 255, 255, 255]))
    expect(await capturePage(browser as unknown as Browser, 'http://localhost:4000')).toEqual(png)
    expect(page.screenshot).toHaveBeenCalledTimes(2)
    expect(page.waitForTimeout).toHaveBeenCalledOnce()
  })

  it('reports JavaScript failures when the page stays blank and releases the browser context', async () => {
    const { browser, page, context } = browserFixture()
    let time = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time)
    page.on.mockImplementation((event, listener) => {
      if (event === 'pageerror') listener(new Error('Application initialization failed'))
    })
    page.screenshot.mockResolvedValue(fixture([255, 255, 255, 255]))
    page.waitForTimeout.mockImplementation(async () => { time = 25_000 })
    try {
      await expect(capturePage(browser as unknown as Browser, 'http://localhost:4000')).rejects.toThrow('The page remained blank. JavaScript: Application initialization failed')
      expect(context.close).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
    }
  })

  it('rejects non-web protocols and embedded credentials before opening a context', async () => {
    const { browser } = browserFixture()
    await expect(capturePage(browser as unknown as Browser, 'file:///tmp/private.html')).rejects.toThrow('HTTP or HTTPS')
    await expect(capturePage(browser as unknown as Browser, 'https://user:password@example.com')).rejects.toThrow('credentials')
    expect(browser.newContext).not.toHaveBeenCalled()
  })
})
