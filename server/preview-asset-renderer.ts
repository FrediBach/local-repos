import type { Browser } from 'playwright'
import { isBlankPreview } from './preview-renderer'
import { HelperError } from './scanner'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const DECODE_TIMEOUT = 8000
const SUPPORTED_TYPES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/webp', 'image/webp'],
  ['image/avif', 'image/avif'],
  ['image/bmp', 'image/bmp'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/gif', 'image/gif'],
  ['image/svg+xml', 'image/svg+xml'],
  ['image/x-icon', 'image/x-icon'],
  ['image/vnd.microsoft.icon', 'image/x-icon'],
  ['image/ico', 'image/x-icon'],
])

/** Decode an untrusted image in a network-isolated browser, preserving its shape and alpha. */
export async function renderPreviewAsset(browser: Browser, image: { bytes: Buffer; mimeType: string }, kind?: 'og-image' | 'logo' | 'favicon'): Promise<Buffer> {
  const mimeType = SUPPORTED_TYPES.get(image.mimeType.split(';')[0].trim().toLowerCase())
  if (!mimeType) throw new HelperError('The preview asset has an unsupported image type.')
  if (!image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES) {
    throw new HelperError('The preview asset must be a nonempty image smaller than 4 MiB.')
  }

  const context = await browser.newContext({ serviceWorkers: 'block' })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const decode = async () => {
      // The image is supplied as data, never navigated to. SVG scripts are inert
      // in an Image, and CSP plus routing also prevent external resource loads.
      await context.route('**/*', (route) => route.abort())
      const page = await context.newPage()
      await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; script-src \'none\'; style-src \'none\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">', { timeout: DECODE_TIMEOUT })
      const dataUrl = `data:${mimeType};base64,${image.bytes.toString('base64')}`
      // Keep this callback free of nested functions: tsx would insert its __name
      // helper into those, which a fresh page lacks. Image bytes stay in the argument.
      const png = await page.evaluate(async (source) => {
        const image = new Image()
        image.src = source
        await image.decode()
        const { naturalWidth: width, naturalHeight: height } = image
        if (!width || !height || width * height > 16000000 || width > 16384 || height > 16384) {
          throw new Error('The preview asset has unsupported image dimensions.')
        }
        const scale = Math.min(1, 1440 / width, 900 / height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('The preview image could not be decoded.')
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let visible = false
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if (pixels[offset] > 0) { visible = true; break }
        }
        // Uniform colors can be legitimate favicons; only reject assets with
        // no visible pixels, unlike full-page screenshot blank detection.
        if (!visible) throw new Error('The preview asset is completely transparent.')
        return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
      }, dataUrl)
      const output = Buffer.from(png, 'base64')
      if (kind === 'og-image' && isBlankPreview(output)) throw new HelperError('The Open Graph preview image is blank.')
      return output
    }
    return await Promise.race([
      decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HelperError('The preview asset could not be decoded within 8 seconds.')), DECODE_TIMEOUT)
      }),
    ])
  } catch (error) {
    if (error instanceof HelperError) throw error
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'Image decoding failed.'
    throw new HelperError(`Could not decode the preview asset: ${detail}`)
  } finally {
    clearTimeout(timer)
    await context.close().catch(() => undefined)
  }
}
