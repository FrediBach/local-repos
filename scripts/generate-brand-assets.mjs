import { readFile, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const root = new URL('../', import.meta.url)
const favicon = await readFile(new URL('public/favicon.svg', root), 'utf8')
// Install icons need an opaque, full-bleed background for OS masking.
const installIcon = favicon.replace('rx="14"', 'rx="0"')
const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()

for (const [filename, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(new URL(`public/${filename}`, root), render(installIcon, size))
}

// ICO directory with one PNG entry; supported by current browsers and Windows.
const png = render(favicon, 32)
const ico = Buffer.alloc(22)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(1, 4)
ico[6] = 32
ico[7] = 32
ico.writeUInt16LE(1, 10)
ico.writeUInt16LE(32, 12)
ico.writeUInt32LE(png.length, 14)
ico.writeUInt32LE(22, 18)
await writeFile(new URL('public/favicon.ico', root), Buffer.concat([ico, png]))

const social = await readFile(new URL('design/og-image.svg', root), 'utf8')
await writeFile(new URL('public/og-image.png', root), render(social, 1200))
console.log('Generated install icons, favicon.ico, and the 1200 × 630 social image.')
