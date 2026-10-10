import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lighthouseProject, parseLighthouseReport, validateLighthousePage, validateLighthouseProject, type LighthouseRunner } from './lighthouse'
import type { RegisteredProject } from './scanner'

const url = 'https://frontend.example/app/'
const categoryIds = ['performance', 'accessibility', 'best-practices', 'seo']

it.skipIf(!existsSync(chromium.executablePath()))('rejects a framework error overlay mounted after the initial HTML load', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html><body><h1>Loading frontend</h1><script>setTimeout(() => document.body.append(document.createElement("vite-error-overlay")), 100)</script></body></html>')
  })
  let browser: Browser | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture server address')
    browser = await chromium.launch({ headless: true })
    await expect(validateLighthousePage(browser, `http://127.0.0.1:${address.port}/`)).rejects.toThrow('development build error')
    expect(browser.contexts()).toHaveLength(0)
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

function report() {
  return { lighthouseVersion: '12.8.2', requestedUrl: url, finalDisplayedUrl: url, configSettings: { formFactor: 'desktop' }, runWarnings: [],
    categories: Object.fromEntries(categoryIds.map(id => [id, { id, title: id, score: 0.92, auditRefs: [{ id: 'check' }] }])),
    audits: { check: { id: 'check', title: 'Check', description: 'Improve the page.', score: 0.5, scoreDisplayMode: 'numeric', displayValue: '1.2 s', numericValue: 1200, numericUnit: 'millisecond', details: { headings: [{ key: 'node', label: 'Element' }], items: [{ node: { type: 'node', snippet: '<img src="test.png">' } }] } } },
  }
}
const runnerFor = (value: unknown) => vi.fn<LighthouseRunner>().mockResolvedValue({ stdout: JSON.stringify(value), stderr: '', exitCode: 0 })

describe('Lighthouse report and process boundary', () => {
  it('runs the installed worker against the owned Chromium port with bounded output, deadline and cancellation', async () => {
    const runner = runnerFor(report())
    const signal = new AbortController().signal
    const result = await lighthouseProject(url, 9223, signal, runner)
    expect(runner).toHaveBeenCalledWith(process.execPath, [expect.stringContaining('/server/lighthouse-worker.mjs'), url, '9223'], expect.objectContaining({ shell: false, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, signal, killSignal: 'SIGKILL' }))
    expect(result).toMatchObject({ version: '12.8.2', requestedUrl: url, url, formFactor: 'desktop', categories: categoryIds.map(id => ({ id, score: 92 })), audits: [{ id: 'check', score: 0.5, categories: categoryIds, numericValue: 1200, details: { items: [{ node: '<img src="test.png">' }] } }], warnings: [] })
  })

  it('retains unavailable scores and errored, manual and not-applicable findings without claiming a pass', () => {
    const value = report()
    const result = parseLighthouseReport({ ...value, categories: { ...value.categories, performance: { ...value.categories.performance, score: null } }, audits: { check: { ...value.audits.check, score: null, scoreDisplayMode: 'error', errorMessage: 'Navigation timed out' } } }, url)
    expect(result.categories[0].score).toBeNull()
    expect(result.audits[0]).toMatchObject({ score: null, scoreDisplayMode: 'error', explanation: 'Navigation timed out' })
    expect(result.warnings.join(' ')).toContain('not passing')
    for (const mode of ['manual', 'notApplicable']) expect(parseLighthouseReport({ ...value, audits: { check: { ...value.audits.check, score: null, scoreDisplayMode: mode } } }, url).audits[0].score).toBeNull()
  })

  it('bounds large diagnostic tables and preserves the number omitted', () => {
    const value = report()
    value.audits.check.details.items = Array.from({ length: 50 }, () => ({ node: { type: 'node', snippet: 'x'.repeat(4000) } }))
    const details = parseLighthouseReport(value, url).audits[0].details!
    expect(details.items).toHaveLength(20)
    expect(details.items[0].node).toHaveLength(2000)
    expect(details.omitted).toBe(30)
  })

  it.each([
    (value: ReturnType<typeof report>) => ({ ...value, lighthouseVersion: '0.0.0' }),
    (value: ReturnType<typeof report>) => ({ ...value, requestedUrl: 'https://other.example/' }),
    (value: ReturnType<typeof report>) => ({ ...value, categories: { ...value.categories, seo: undefined } }),
    (value: ReturnType<typeof report>) => ({ ...value, audits: {} }),
    (value: ReturnType<typeof report>) => ({ ...value, finalDisplayedUrl: 'file:///tmp/private' }),
    (value: ReturnType<typeof report>) => ({ ...value, configSettings: { formFactor: 'mobile' } }),
    (value: ReturnType<typeof report>) => ({ ...value, categories: { ...value.categories, performance: { ...value.categories.performance, score: 92 } } }),
    (value: ReturnType<typeof report>) => ({ ...value, audits: { check: { ...value.audits.check, score: Number.NaN } } }),
  ])('rejects malformed or mismatched reports', change => {
    expect(() => parseLighthouseReport(change(report()), url)).toThrow('complete, supported report')
  })

  it('surfaces fatal page failures, invalid JSON, process limits and cancellation', async () => {
    expect(() => parseLighthouseReport({ ...report(), runtimeError: { code: 'NO_FCP', message: 'No content painted' } }, url)).toThrow('No content painted')
    const signal = new AbortController().signal
    await expect(lighthouseProject(url, 9223, signal, runnerFor({}))).rejects.toMatchObject({ status: 502 })
    await expect(lighthouseProject(url, 9223, signal, vi.fn<LighthouseRunner>().mockResolvedValue({ stdout: '', stderr: 'Unable to connect', exitCode: 1 }))).rejects.toThrow('Unable to connect')
    for (const [failure, message] of [[{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '16 MB'], [{ killed: true }, 'two-minute'], [{ code: 'ENOENT' }, 'Reinstall']] as const) {
      await expect(lighthouseProject(url, 9223, signal, vi.fn<LighthouseRunner>().mockRejectedValue(failure))).rejects.toThrow(message)
    }
    const controller = new AbortController()
    controller.abort()
    await expect(lighthouseProject(url, 9223, controller.signal, vi.fn<LighthouseRunner>().mockRejectedValue(new Error('Aborted')))).rejects.toMatchObject({ status: 503 })
  })
})

describe('Lighthouse frontend validation', () => {
  let directory: string
  let entry: RegisteredProject
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-lighthouse-'))
    entry = { directory, root: directory, project: {
      id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.',
      description: '', stack: [], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '',
    } }
    await writeFile(path.join(directory, 'package.json'), '{"scripts":{"dev":"vite"}}')
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('checks fresh metadata, accepts explicit application URLs, and rejects stale frontend commands', async () => {
    expect(await validateLighthouseProject(entry)).toBeUndefined()
    await writeFile(path.join(directory, 'package.json'), '{"scripts":{"dev":"vite --host"}}')
    await expect(validateLighthouseProject(entry)).rejects.toMatchObject({ status: 409 })
    entry.project.previewUrl = url
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ localRepos: { previewUrl: url } }))
    expect(await validateLighthouseProject(entry)).toBe(url)
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ localRepos: { previewUrl: 'https://changed.example/' } }))
    await expect(validateLighthouseProject(entry)).rejects.toMatchObject({ status: 409 })
  })

  it('rejects backend/library packages, invalid manifests and symlinks', async () => {
    for (const manifest of ['{"scripts":{"dev":"node api.js"},"dependencies":{"react":"1"}}', '{"homepage":"https://frontend.example/"}']) {
      await writeFile(path.join(directory, 'package.json'), manifest)
      await expect(validateLighthouseProject(entry)).rejects.toThrow('runnable frontend')
    }
    await writeFile(path.join(directory, 'package.json'), '[]')
    await expect(validateLighthouseProject(entry)).rejects.toThrow('regular, valid package.json')
    await rm(path.join(directory, 'package.json'))
    await writeFile(path.join(directory, 'manifest.json'), '{"scripts":{"dev":"vite"}}')
    await symlink(path.join(directory, 'manifest.json'), path.join(directory, 'package.json'))
    await expect(validateLighthouseProject(entry)).rejects.toThrow('regular, valid package.json')
  })

  it('preflights an isolated HTML page and closes it on every failure', async () => {
    const response = { ok: vi.fn(() => true), status: () => 200, headers: vi.fn(() => ({ 'content-type': 'text/html; charset=utf-8' })) }
    const page = { goto: vi.fn(async () => response), evaluate: vi.fn(async () => {}), locator: vi.fn(() => ({ count: vi.fn(async () => 0) })) }
    const context = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) }
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser
    await validateLighthousePage(browser, url)
    expect(context.close).toHaveBeenCalledOnce()
    response.headers.mockReturnValue({ 'content-type': 'application/json' })
    await expect(validateLighthousePage(browser, url)).rejects.toThrow('HTML frontend')
    response.ok.mockReturnValue(false)
    await expect(validateLighthousePage(browser, url)).rejects.toThrow('HTTP 200')
    response.ok.mockReturnValue(true)
    response.headers.mockReturnValue({ 'content-type': 'text/html' })
    page.locator.mockReturnValue({ count: vi.fn(async () => 1) })
    await expect(validateLighthousePage(browser, url)).rejects.toThrow('development build error')
    expect(context.close).toHaveBeenCalledTimes(4)
    await expect(validateLighthousePage(browser, 'file:///tmp/page')).rejects.toThrow('HTTP or HTTPS')
    expect(browser.newContext).toHaveBeenCalledTimes(4)
  })

  it('bounds preflight after navigation even when frontend JavaScript stalls', async () => {
    vi.useFakeTimers()
    const page = { goto: async () => ({ ok: () => true, headers: () => ({ 'content-type': 'text/html' }) }), evaluate: () => new Promise(() => {}) }
    const context = { newPage: async () => page, close: vi.fn(async () => {}) }
    const browser = { newContext: async () => context } as unknown as Browser
    try {
      const failed = expect(validateLighthousePage(browser, url)).rejects.toThrow('within 25 seconds')
      await vi.advanceTimersByTimeAsync(25_000)
      await failed
      expect(context.close).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
})
