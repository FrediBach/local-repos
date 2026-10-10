import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ProjectRuntime } from './runtime'
import { ProjectRegistry, scanDirectory } from './scanner'

it.skipIf(!existsSync(chromium.executablePath()))('audits a disposable frontend with the installed Lighthouse and Chromium', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-lighthouse-integration-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A disposable Lighthouse test page."><title>Lighthouse fixture</title><style>body{font:18px system-ui;background:#fff;color:#111;padding:48px}h1{font-size:36px}</style></head><body><main><h1>A testable frontend</h1><p>This local fixture has no external resources or project scripts.</p></main></body></html>')
  })
  const registry = new ProjectRegistry()
  const runtime = new ProjectRuntime(registry)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture server address')
    const url = `http://127.0.0.1:${address.port}/`
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'lighthouse-fixture', localRepos: { previewUrl: url } }))
    const { registered } = await scanDirectory(directory)
    registry.register(registered)
    const progress = vi.fn()
    const report = await runtime.lighthouse(registered[0].project.id, progress)
    expect(report).toMatchObject({ version: '12.8.2', requestedUrl: url, url, formFactor: 'desktop' })
    expect(report.categories.map(category => category.id)).toEqual(['performance', 'accessibility', 'best-practices', 'seo'])
    expect(report.categories.every(category => category.score !== null && category.score >= 0 && category.score <= 100)).toBe(true)
    expect(report.audits.length).toBeGreaterThan(20)
    expect(report.audits.find(audit => audit.id === 'largest-contentful-paint')?.numericValue).toBeGreaterThan(0)
    expect(report.audits.some(audit => ['screenshot-thumbnails', 'final-screenshot'].includes(audit.id))).toBe(false)
    expect(registry.lookup(registered[0].project.id).project.lighthouse).toEqual(report)
    const phases = progress.mock.calls.map(([value]) => value.phase)
    expect(phases).toContain('Collecting browser performance and page data')
    expect(phases).toContain('Evaluating Lighthouse audit checks')
    expect(phases.indexOf('Evaluating Lighthouse audit checks')).toBeLessThan(phases.indexOf('Calculating Lighthouse category scores'))
    expect(phases.indexOf('Calculating Lighthouse category scores')).toBeLessThan(phases.indexOf('Validating Lighthouse findings and scores'))
  } finally {
    await runtime.shutdown()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
