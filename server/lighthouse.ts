import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import type { Browser } from 'playwright'
import type { LighthouseAudit, LighthouseCategoryId, LighthouseReport, ScanProgressReporter } from '../src/types'
import { isLighthouseProject } from '../src/lib/lighthouse'
import { selectDevScript } from '../src/lib/dev-script'
import { normalizePreviewUrl, parsePackageJson } from '../src/lib/metadata'
import { HelperError, type RegisteredProject } from './scanner'
import { settlePage } from './preview-renderer'
import { observeScanProgress, withoutScanProgress } from './scan-worker-progress'

const require = createRequire(import.meta.url)
const lighthouseVersion: string = require('lighthouse/package.json').version
const worker = fileURLToPath(new URL('./lighthouse-worker.mjs', import.meta.url))
const categoryIds: LighthouseCategoryId[] = ['performance', 'accessibility', 'best-practices', 'seo']
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, limit = 4000): string => typeof value === 'string' ? stripVTControlCharacters(value).slice(0, limit) : ''
const score = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)

interface LighthouseOutput { stdout: string; stderr: string; exitCode: number }
export type LighthouseRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<LighthouseOutput>
const createLighthouseRunner = (onProgress?: ScanProgressReporter): LighthouseRunner => (command, args, options) => new Promise((resolve, reject) => {
  const child = execFile(command, args, options, (error, stdout, stderr) => {
    if (error && (typeof error.code !== 'number' || error.killed || error.signal)) { reject(error); return }
    resolve({ stdout, stderr: withoutScanProgress(stderr), exitCode: error?.code as number | undefined ?? 0 })
  })
  if (onProgress) observeScanProgress(child.stderr, onProgress)
})
const runLighthouse = createLighthouseRunner()

/** Re-read bounded metadata without following a replaced manifest symlink. */
export async function validateLighthouseProject(entry: RegisteredProject): Promise<string | undefined> {
  let current: ReturnType<typeof parsePackageJson>
  try {
    const handle = await open(path.join(entry.directory, 'package.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid manifest')
      current = parsePackageJson(await handle.readFile('utf8'))
    } finally { await handle.close() }
  } catch { throw new HelperError('Lighthouse requires a regular, valid package.json file smaller than 256 KB.') }
  if (!isLighthouseProject(entry.project) || !isLighthouseProject(current)) throw new HelperError('Lighthouse requires a runnable frontend or an explicit localRepos.previewUrl pointing to the application.')
  if (current.previewUrl !== entry.project.previewUrl) throw new HelperError('The application URL changed. Resync the project before running Lighthouse.', 409)
  if (current.previewUrl) return current.previewUrl
  const selected = selectDevScript(entry.project)
  const fresh = selectDevScript(current)
  if (!selected || !fresh || fresh.name !== selected.name || fresh.command !== selected.command) throw new HelperError('The frontend script changed. Resync the project before running Lighthouse.', 409)
  return undefined
}

/** A running API, failed framework build, or arbitrary file is not a frontend. */
export async function validateLighthousePage(browser: Browser, url: string): Promise<void> {
  if (!normalizePreviewUrl(url)) throw new HelperError('Lighthouse requires a valid HTTP or HTTPS application URL.')
  const context = await browser.newContext({ ignoreHTTPSErrors: false })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const check = async () => {
      const page = await context.newPage()
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      if (!response || !response.ok()) throw new HelperError(`The frontend returned HTTP ${response?.status() ?? 'no response'}. Fix the application before running Lighthouse.`, 422)
      const contentType = response.headers()['content-type'] ?? ''
      if (!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(contentType)) throw new HelperError('Lighthouse requires an HTML frontend. This URL serves an API or another non-page response.', 422)
      // Framework compilation and hydration can mount error overlays after the
      // initial HTML arrives. Apply the same bounded settling used for previews.
      await settlePage(page, 2000)
      if (await page.locator('vite-error-overlay, nextjs-portal [data-nextjs-dialog-overlay], #webpack-dev-server-client-overlay').count()) throw new HelperError('The frontend displays a development build error. Fix it before running Lighthouse.', 422)
    }
    // Page JavaScript can block evaluation even after navigation succeeds.
    await Promise.race([check(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HelperError('The frontend did not become testable within 25 seconds.', 504)), 25_000)
    })])
  } finally { clearTimeout(timer); await context.close().catch(() => undefined) }
}

function invalidReport(): never {
  throw new HelperError('Lighthouse did not return a complete, supported report for this application. Try again after checking the frontend.', 502)
}

function detailValue(value: unknown): string {
  if (typeof value === 'string') return text(value, 2000)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (object(value)) {
    for (const key of ['snippet', 'selector', 'url', 'value', 'text', 'label']) {
      if (typeof value[key] === 'string' || typeof value[key] === 'number') return detailValue(value[key])
    }
  }
  return ''
}

function auditDetails(value: unknown): LighthouseAudit['details'] {
  if (!object(value) || !Array.isArray(value.headings) || !Array.isArray(value.items)) return undefined
  const headings = value.headings.filter(object).filter(heading => typeof heading.key === 'string' && heading.key && typeof heading.label === 'string')
    .slice(0, 8).map(heading => ({ key: text(heading.key, 200), label: text(heading.label, 200) }))
  if (!headings.length) return undefined
  const items = value.items.filter(object).slice(0, 20).map(item => Object.fromEntries(headings.map(heading => [heading.key, detailValue(item[heading.key])])))
  return { headings, items, ...(value.items.length > items.length ? { omitted: value.items.length - items.length } : {}) }
}

export function parseLighthouseReport(value: unknown, requestedUrl: string): LighthouseReport {
  if (!object(value)) invalidReport()
  if (object(value.runtimeError)) throw new HelperError(`Lighthouse could not audit this frontend. ${text(value.runtimeError.message) || text(value.runtimeError.code)}`, 422)
  if (value.lighthouseVersion !== lighthouseVersion || !object(value.categories) || !object(value.audits)
    || !object(value.configSettings) || value.configSettings.formFactor !== 'desktop'
    || value.requestedUrl !== requestedUrl || !Array.isArray(value.runWarnings) || !value.runWarnings.every(warning => typeof warning === 'string')) invalidReport()
  const url = normalizePreviewUrl(value.finalDisplayedUrl ?? value.finalUrl)
  if (!url) invalidReport()
  const memberships = new Map<string, LighthouseCategoryId[]>()
  const categories = categoryIds.map(id => {
    const category = (value.categories as Record<string, unknown>)[id]
    if (!object(category) || category.id !== id || typeof category.title !== 'string' || !score(category.score)
      || !Array.isArray(category.auditRefs) || !category.auditRefs.length || category.auditRefs.length > 1000) invalidReport()
    for (const reference of category.auditRefs) {
      if (!object(reference) || typeof reference.id !== 'string') invalidReport()
      const ids = memberships.get(reference.id) ?? []
      if (!ids.includes(id)) ids.push(id)
      memberships.set(reference.id, ids)
    }
    return { id, title: text(category.title, 200), score: category.score === null ? null : Math.round(category.score * 100) }
  })
  const audits: LighthouseAudit[] = [...memberships].map(([id, categories]) => {
    const audit = (value.audits as Record<string, unknown>)[id]
    if (!object(audit) || audit.id !== id || typeof audit.title !== 'string' || typeof audit.description !== 'string'
      || typeof audit.scoreDisplayMode !== 'string' || !score(audit.score)) invalidReport()
    return { id, title: text(audit.title), description: text(audit.description, 8000), score: audit.score,
      scoreDisplayMode: text(audit.scoreDisplayMode, 100), categories,
      ...(typeof audit.displayValue === 'string' ? { displayValue: text(audit.displayValue) } : {}),
      ...(typeof audit.numericValue === 'number' && Number.isFinite(audit.numericValue) ? { numericValue: audit.numericValue } : {}),
      ...(typeof audit.numericUnit === 'string' ? { numericUnit: text(audit.numericUnit, 100) } : {}),
      ...(typeof audit.explanation === 'string' || typeof audit.errorMessage === 'string' ? { explanation: text(audit.explanation ?? audit.errorMessage) } : {}),
      ...(auditDetails(audit.details) ? { details: auditDetails(audit.details) } : {}),
    }
  })
  const warnings = value.runWarnings.slice(0, 30).map(warning => text(warning))
  if (categories.some(category => category.score === null) || audits.some(audit => audit.scoreDisplayMode === 'error')) warnings.push('Some Lighthouse checks could not finish. Unavailable scores are not passing results.')
  return { scannedAt: new Date().toISOString(), version: lighthouseVersion, requestedUrl, url, formFactor: 'desktop', categories, audits, warnings }
}

export async function lighthouseProject(url: string, port: number, signal: AbortSignal, runner: LighthouseRunner = runLighthouse, onProgress?: ScanProgressReporter): Promise<LighthouseReport> {
  if (onProgress && runner === runLighthouse) runner = createLighthouseRunner(onProgress)
  let output: LighthouseOutput
  try {
    onProgress?.({ phase: 'Starting Lighthouse browser analysis' })
    output = await runner(process.execPath, [worker, url, String(port)], {
      cwd: path.dirname(worker), encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      signal, killSignal: 'SIGKILL', env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    })
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (signal.aborted) throw new HelperError('The Lighthouse scan stopped because the local helper is shutting down.', 503)
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('The Lighthouse report exceeded the 16 MB output limit.', 502)
    if (failure.killed || failure.signal) throw new HelperError('Lighthouse exceeded its two-minute scan limit or stopped unexpectedly.', 504)
    throw new HelperError(`Could not start Lighthouse. Reinstall Local Repos dependencies and try again. ${text(failure.message)}`, 502)
  }
  if (output.exitCode !== 0) throw new HelperError(`Lighthouse could not complete the scan. ${text(output.stderr || output.stdout)}`, 502)
  onProgress?.({ phase: 'Validating Lighthouse findings and scores' })
  let value: unknown
  try { value = JSON.parse(output.stdout) } catch { invalidReport() }
  return parseLighthouseReport(value, url)
}
