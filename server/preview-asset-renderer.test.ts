import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderPreviewAsset } from './preview-asset-renderer'

function image(width = 16, height = 16, rgba = [200, 40, 80, 255]) {
  const png = new PNG({ width, height })
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(rgba, offset)
  return PNG.sync.write(png)
}

function browserFixture() {
  const png = image()
  const page = { setContent: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue(png.toString('base64')) }
  const context = {
    route: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const browser = { newContext: vi.fn().mockResolvedValue(context) }
  return { browser: browser as unknown as Browser, context, page, png }
}

describe('preview asset isolation', () => {
  it('uses an isolated context, blocks network requests, and supplies image bytes only as data', async () => {
    const { browser, context, page, png } = browserFixture()
    expect(await renderPreviewAsset(browser, { bytes: png, mimeType: 'IMAGE/PNG; charset=binary' })).toEqual(png)
    expect(browser.newContext).toHaveBeenCalledWith({ serviceWorkers: 'block' })
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    const route = { abort: vi.fn() }
    context.route.mock.calls[0][1](route)
    expect(route.abort).toHaveBeenCalledOnce()
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining("default-src 'none'; img-src data:; script-src 'none'"), expect.any(Object))
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), `data:image/png;base64,${png.toString('base64')}`)
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects unsupported types, empty files, and oversized input before opening a browser context', async () => {
    const { browser } = browserFixture()
    await expect(renderPreviewAsset(browser, { bytes: Buffer.from('<html>'), mimeType: 'text/html' })).rejects.toThrow('unsupported image type')
    await expect(renderPreviewAsset(browser, { bytes: Buffer.alloc(0), mimeType: 'image/png' })).rejects.toThrow('nonempty')
    await expect(renderPreviewAsset(browser, { bytes: Buffer.alloc(4 * 1024 * 1024 + 1), mimeType: 'image/png' })).rejects.toThrow('4 MiB')
    expect(browser.newContext).not.toHaveBeenCalled()
  })

  it('closes the context after a decoding error', async () => {
    const { browser, context, page, png } = browserFixture()
    page.evaluate.mockRejectedValue(new Error('The source image cannot be decoded.'))
    await expect(renderPreviewAsset(browser, { bytes: png, mimeType: 'image/png' })).rejects.toThrow('Could not decode the preview asset')
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('closes a hung decoder after the time limit', async () => {
    vi.useFakeTimers()
    try {
      const { browser, context, page, png } = browserFixture()
      page.evaluate.mockImplementation(() => new Promise(() => {}))
      const capture = renderPreviewAsset(browser, { bytes: png, mimeType: 'image/png' })
      const assertion = expect(capture).rejects.toThrow('within 8 seconds')
      await vi.advanceTimersByTimeAsync(8000)
      await assertion
      expect(context.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

// Exercise the actual product decoder when its optional Chromium installation
// exists. Pure validation/isolation tests above still run without a browser.
describe.skipIf(!existsSync(chromium.executablePath()))('preview asset decoding in Chromium', () => {
  let browser: Browser
  beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 15_000)
  afterAll(async () => { await browser?.close() })

  it('preserves tiny solid-color icons without upscaling them', async () => {
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: image(), mimeType: 'image/png' }))
    expect([output.width, output.height]).toEqual([16, 16])
    expect([...output.data.slice(0, 4)]).toEqual([200, 40, 80, 255])
  })

  it('preserves transparent padding around logos', async () => {
    const png = PNG.sync.read(image(32, 32, [0, 0, 0, 0]))
    png.data.set([50, 150, 200, 255], (16 * 32 + 16) * 4)
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: PNG.sync.write(png), mimeType: 'image/png' }))
    expect(output.data[3]).toBe(0)
    expect([...output.data.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4)]).toEqual([50, 150, 200, 255])
  })

  it('rejects a blank Open Graph image while permitting the same solid color as a favicon', async () => {
    const blank = { bytes: image(1200, 630, [255, 255, 255, 255]), mimeType: 'image/png' }
    await expect(renderPreviewAsset(browser, blank, 'og-image')).rejects.toThrow('Open Graph preview image is blank')
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: image(), mimeType: 'image/png' }, 'favicon'))
    expect([output.width, output.height]).toEqual([16, 16])
  })

  it('scales large images to fit the preview bounds while preserving aspect ratio', async () => {
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: image(3000, 1500), mimeType: 'image/png' }))
    expect([output.width, output.height]).toEqual([1440, 720])
  })

  it('rasterizes SVG without running its scripts or fetching external resources', async () => {
    const requests: string[] = []
    const original = browser.newContext.bind(browser)
    const spy = vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
      const context = await original(options)
      context.on('request', (request) => requests.push(request.url()))
      return context
    })
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20" onload="document.getElementById(\'mark\').setAttribute(\'fill\',\'blue\')"><script>document.getElementById("mark").setAttribute("fill","blue")</script><rect id="mark" width="32" height="20" fill="red"/><image href="https://example.com/private.png" width="1" height="1"/></svg>'
      const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: Buffer.from(svg), mimeType: 'image/svg+xml' }))
      expect([output.width, output.height]).toEqual([32, 20])
      expect([...output.data.slice(40, 44)]).toEqual([255, 0, 0, 255])
      expect(requests.filter((url) => /^https?:/.test(url))).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('decodes an ICO containing a PNG into the same PNG dimensions', async () => {
    const png = image(32, 32)
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header[6] = 32
    header[7] = 32
    header.writeUInt16LE(1, 10)
    header.writeUInt16LE(32, 12)
    header.writeUInt32LE(png.length, 14)
    header.writeUInt32LE(22, 18)
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes: Buffer.concat([header, png]), mimeType: 'image/vnd.microsoft.icon' }))
    expect([output.width, output.height]).toEqual([32, 32])
  })

  it.each(['image/jpeg', 'image/webp'])('converts %s assets into PNG', async (mimeType) => {
    const fixtureContext = await browser.newContext()
    let bytes: Buffer
    try {
      const page = await fixtureContext.newPage()
      const data = await page.evaluate((type) => {
        const canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 12
        const context = canvas.getContext('2d')!
        context.fillStyle = '#c82850'
        context.fillRect(0, 0, 24, 12)
        return canvas.toDataURL(type).split(',')[1]
      }, mimeType)
      bytes = Buffer.from(data, 'base64')
    } finally {
      await fixtureContext.close()
    }
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes, mimeType }))
    expect([output.width, output.height]).toEqual([24, 12])
    expect(output.data[3]).toBe(255)
  })

  it('converts a GIF favicon into PNG', async () => {
    const bytes = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACwAAAAAAQABAAACAkQBADs=', 'base64')
    const output = PNG.sync.read(await renderPreviewAsset(browser, { bytes, mimeType: 'image/gif' }))
    expect([output.width, output.height]).toEqual([1, 1])
    expect(output.data[3]).toBe(255)
  })

  it('rejects fully transparent images, corrupt images, and unreasonable SVG dimensions', async () => {
    await expect(renderPreviewAsset(browser, { bytes: image(16, 16, [0, 0, 0, 0]), mimeType: 'image/png' })).rejects.toThrow('completely transparent')
    await expect(renderPreviewAsset(browser, { bytes: Buffer.from('not an image'), mimeType: 'image/png' })).rejects.toThrow('Could not decode')
    await expect(renderPreviewAsset(browser, { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"><rect width="8000" height="8000" fill="red"/></svg>'), mimeType: 'image/svg+xml' })).rejects.toThrow('unsupported image dimensions')
  })
})
