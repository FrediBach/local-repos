import { expect, it, vi } from 'vitest'
import { scanCodeMetrics, type CodeSource } from './code-metrics'

function source(files: Record<string, string | undefined>): CodeSource {
  return {
    async *entries(directory) {
      const prefix = directory ? `${directory}/` : ''
      const seen = new Set<string>()
      for (const path of Object.keys(files).filter(path => path.startsWith(prefix))) {
        const tail = path.slice(prefix.length)
        const name = tail.split('/')[0]
        if (seen.has(name)) continue
        seen.add(name)
        yield { name, kind: tail.includes('/') ? 'directory' : 'file' }
      }
    },
    read: async (path, maxBytes) => !(path in files) ? null : files[path] === undefined || new TextEncoder().encode(files[path]).byteLength > maxBytes ? undefined : files[path],
  }
}

it('counts nonblank lines including comments across newline styles, with source and config types', async () => {
  const report = await scanCodeMetrics(source({
    'main.ts': '// comment\r\n\r\nconst x = 1\n  \nlast line',
    'other.ts': 'one\rtwo\r', 'ui.tsx': '<div />\n', 'empty.py': '',
    'package.json': '{}', 'package-lock.json': '{}', 'README.md': '# prose',
    'binary.js': 'bad\0file', 'dist/build.js': 'generated', 'node_modules/lib.js': 'dependency',
    'Dockerfile': 'FROM scratch\n', '.hidden/script.sh': '#!/bin/sh\necho hi',
    constructor: 'unknown', 'file.__proto__': 'unknown', ts: 'not an extension',
  }))
  expect(report).toMatchObject({ totalLines: 10, totalFiles: 7, partial: false, warnings: [] })
  expect(report.languages[0]).toMatchObject({ name: 'TypeScript', lines: 5, files: 2 })
  expect(report.languages.find(row => row.name === 'Python')).toMatchObject({ name: 'Python', lines: 0, files: 1, fileStatistics: { average: 0, min: 0, max: 0, median: 0 } })
})

it('calculates overall statistics from individual files, with even and odd medians per type', async () => {
  const text = (lines: number) => 'code\n'.repeat(lines)
  const report = await scanCodeMetrics(source({
    '.gitignore': 'ignored.ts', 'ignored.ts': text(999), 'binary.ts': '\0',
    'a.ts': text(10), 'b.ts': text(2), 'c.ts': ' \n\t\n',
    'a.css': text(4), 'b.css': text(1), 'empty.py': '',
  }))
  // [0, 0, 1, 2, 4, 10]; overall median must not average the per-type medians.
  expect(report).toMatchObject({ totalFiles: 6, totalLines: 17, fileStatistics: { average: 17 / 6, min: 0, max: 10, median: 1.5 } })
  expect(report.languages.find(row => row.name === 'TypeScript')?.fileStatistics).toEqual({ average: 4, min: 0, max: 10, median: 2 })
  expect(report.languages.find(row => row.name === 'CSS')?.fileStatistics).toEqual({ average: 2.5, min: 1, max: 4, median: 2.5 })
  expect(JSON.stringify(report)).not.toContain('lineCounts')
  expect(report.distribution?.map(bucket => bucket.files)).toEqual([2, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1])
  expect(report.languages.find(row => row.name === 'CSS')?.distribution?.map(bucket => bucket.files)).toEqual([0, 1, 0, 0, 1])
})

it('distinguishes zero-file statistics from single-file statistics and limits partial stats to readable files', async () => {
  expect((await scanCodeMetrics(source({ 'README.md': 'prose' }))).fileStatistics).toEqual({ average: null, min: null, max: null, median: null })
  const partial = await scanCodeMetrics(source({ 'main.ts': 'one\ntwo\n', 'unreadable.ts': undefined }))
  expect(partial).toMatchObject({ totalFiles: 1, partial: true, fileStatistics: { average: 2, min: 2, max: 2, median: 2 } })
  expect(partial.distribution?.reduce((sum, bucket) => sum + bucket.files, 0)).toBe(1)
})

it('respects nested, anchored, directory, glob, escaped and negated ignore rules', async () => {
  const report = await scanCodeMetrics(source({
    '.gitignore': '/root.ts\n*.generated.ts\ncache/\n!cache/keep.ts\n\\#secret.ts\nspace\\ file.ts\n',
    'root.ts': 'excluded', 'nested/root.ts': 'included',
    'one.generated.ts': 'excluded', 'nested/two.generated.ts': 'excluded',
    'cache/keep.ts': 'excluded parent cannot be re-included', '#secret.ts': 'excluded', 'space file.ts': 'excluded',
    'src/.gitignore': '!keep.generated.ts\n/local.ts\n',
    'src/keep.generated.ts': 'included', 'src/local.ts': 'excluded', 'src/deep/local.ts': 'included',
  }))
  expect(report).toMatchObject({ totalLines: 3, totalFiles: 3, partial: false })
})

it('retains separate top tens per type and overall, with project-relative paths', async () => {
  const files: Record<string, string> = {}
  for (let index = 0; index < 12; index += 1) {
    files[`repo/apps/web/src/file-${index}.ts`] = 'code\n'.repeat(1000 + index)
    files[`repo/apps/web/styles/file-${index}.css`] = 'style\n'.repeat(500 + index)
  }
  const report = await scanCodeMetrics(source(files), 'repo/apps/web')
  expect(report.largestFiles).toHaveLength(10)
  expect(report.largestFiles?.every(file => file.language === 'TypeScript')).toBe(true)
  expect(report.largestFiles?.[0]).toEqual({ path: 'src/file-11.ts', language: 'TypeScript', lines: 1011 })
  expect(report.largestFiles?.at(-1)?.lines).toBe(1002)
  const css = report.languages.find(row => row.name === 'CSS')!
  expect(css.largestFiles).toHaveLength(10)
  expect(css.largestFiles?.[0]).toEqual({ path: 'styles/file-11.css', language: 'CSS', lines: 511 })
  expect(css.largestFiles?.at(-1)?.lines).toBe(502)
})

it('includes exactly 500 nonblank lines, breaks ties by path and excludes ignored or unreadable files', async () => {
  const report = await scanCodeMetrics(source({
    '.gitignore': 'ignored.ts', 'ignored.ts': 'code\n'.repeat(900),
    'z.ts': 'code\n'.repeat(500), 'a.ts': 'code\n'.repeat(500),
    'small.ts': 'code\n'.repeat(499) + '\n'.repeat(100),
    'binary.ts': '\0' + 'code\n'.repeat(900), 'unreadable.ts': undefined,
  }))
  expect(report.partial).toBe(true)
  expect(report.largestFiles).toEqual([{ path: 'a.ts', language: 'TypeScript', lines: 500 }, { path: 'z.ts', language: 'TypeScript', lines: 500 }])
  expect((await scanCodeMetrics(source({ 'small.ts': 'code' }))).largestFiles).toEqual([])
})

it('inherits ancestor rules for workspace members and separates nested repositories', async () => {
  const files = {
    '.gitignore': '*.ts', 'repo/.git/HEAD': 'ref', 'repo/.gitignore': '*.generated.ts',
    'repo/apps/app/main.ts': 'included', 'repo/apps/app/out.generated.ts': 'excluded',
    'repo/apps/.gitignore': 'other.ts', 'repo/apps/app/other.ts': 'excluded',
    'repo/nested/.git/HEAD': 'ref', 'repo/nested/out.generated.ts': 'separate repo',
  }
  expect(await scanCodeMetrics(source(files), 'repo/apps/app')).toMatchObject({ totalLines: 1, partial: false })
  expect(await scanCodeMetrics(source(files), 'repo')).toMatchObject({ totalLines: 1, partial: false })
  expect(await scanCodeMetrics(source(files), 'repo/nested')).toMatchObject({ totalLines: 1, partial: false })
})

it('skips a directly selected package excluded by ancestor rules', async () => {
  expect(await scanCodeMetrics(source({ '.gitignore': 'apps/', 'apps/app/main.ts': 'excluded' }), 'apps/app')).toMatchObject({ totalLines: 0, partial: false })
  expect(await scanCodeMetrics(source({ '.gitignore': 'apps/', 'apps/.gitignore': '!app/', 'apps/app/main.ts': 'excluded' }), 'apps/app')).toMatchObject({ totalLines: 0, partial: false })
})

it('does not require ignore files outside a project’s repository boundary', async () => {
  expect(await scanCodeMetrics(source({ '.gitignore': undefined, 'repo/.git/HEAD': 'ref', 'repo/main.ts': 'included' }), 'repo')).toMatchObject({ totalLines: 1, partial: false })
})

it('does not count folders whose ignore rules are unavailable and marks oversized files partial', async () => {
  const report = await scanCodeMetrics(source({
    'main.py': 'ok', 'large.ts': 'x'.repeat(1024 * 1024 + 1),
    'private/.gitignore': undefined, 'private/hidden.ts': 'must not read',
  }))
  expect(report).toMatchObject({ totalLines: 1, partial: true })
  expect(report.warnings).toHaveLength(2)
})

it('bounds file entries, traversal depth, aggregate bytes and scan time', async () => {
  const entries = await scanCodeMetrics({
    async *entries() { for (let i = 0; i < 21_000; i += 1) yield { name: `${i}.unknown`, kind: 'file' } },
    read: async () => null,
  })
  expect(entries.partial).toBe(true)
  const deep = await scanCodeMetrics(source({ [`${'nested/'.repeat(22)}file.ts`]: 'deep' }))
  expect(deep).toMatchObject({ partial: true, totalLines: 0 })
  const large = await scanCodeMetrics(source(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`${i}.ts`, 'x'.repeat(1024 * 1024)]))))
  expect(large).toMatchObject({ partial: true, totalFiles: 32 })
  const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001)
  try { expect((await scanCodeMetrics(source({ 'main.ts': 'line' }))).partial).toBe(true) } finally { now.mockRestore() }
})
