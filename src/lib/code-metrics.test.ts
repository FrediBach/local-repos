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
  expect(report.languages[0]).toEqual({ name: 'TypeScript', lines: 5, files: 2 })
  expect(report.languages.find(row => row.name === 'Python')).toEqual({ name: 'Python', lines: 0, files: 1 })
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
