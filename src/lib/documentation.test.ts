import { expect, it, vi } from 'vitest'
import { scanDocumentation, type DocumentationSource } from './documentation'

it('bounds cached content while keeping uncached filenames available', async () => {
  const read = vi.fn(async (_path: string, maxBytes: number) => maxBytes >= 128 * 1024 ? 'x'.repeat(128 * 1024) : undefined)
  const docs = await scanDocumentation(['docs'], {
    async *entries() { for (let index = 0; index < 6; index += 1) yield { name: `${index}.md`, kind: 'file' } }, read,
  })
  expect(docs.files).toHaveLength(6)
  expect(docs.files.filter(file => file.content !== undefined)).toHaveLength(4)
  expect(docs.files[4].unavailable).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(4)
  expect(docs.warnings.join(' ')).toContain('512 KiB')
})

it('stops large file lists and directory traversals and reports incomplete discovery', async () => {
  const files = await scanDocumentation(['docs'], {
    async *entries() { for (let index = 0; index < 205; index += 1) yield { name: `${index}.md`, kind: 'file' } },
    read: async () => '',
  })
  expect(files.files).toHaveLength(200)
  expect(files.warnings.join(' ')).toContain('Some files may be missing')
  let visits = 0
  const deep = await scanDocumentation(['docs'], {
    async *entries() { visits += 1; yield { name: 'nested', kind: 'directory' }; yield { name: 'guide.md', kind: 'file' } },
    read: async () => '# Guide',
  })
  expect(visits).toBe(8)
  expect(deep.files).toHaveLength(8)
  expect(deep.warnings.join(' ')).toContain('8 folder levels')
})

it('bounds non-Markdown entries and keeps folder read failures visible', async () => {
  let entries = 0
  const source: DocumentationSource = {
    async *entries(path) {
      if (path === 'doc') throw new Error('Unreadable directory')
      for (let index = 0; index < 2_100; index += 1) { entries += 1; yield { name: `${index}.txt`, kind: 'file' } }
    },
    read: vi.fn(),
  }
  const docs = await scanDocumentation(['doc', 'docs'], source)
  expect(entries).toBeLessThanOrEqual(2_001)
  expect(source.read).not.toHaveBeenCalled()
  expect(docs.warnings.join(' ')).toContain('doc: documentation folder could not be read')
  expect(docs.warnings.join(' ')).toContain('2,000 entries')
})
