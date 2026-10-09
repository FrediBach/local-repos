import { spawn, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { CoverageMetric, CoverageMetrics, CoverageRunner, TestCoverageReport } from '../src/types'
import { selectCoverageScript, type CoverageScriptSelection } from '../src/lib/test-coverage'
import { ensureCoverageProvider } from './coverage-tool-cache'
import { HelperError, isWithin, type RegisteredProject } from './scanner'

const MAX_REPORT_BYTES = 8 * 1024 * 1024
const MAX_FILES = 20_000
const metricNames = ['lines', 'statements', 'functions', 'branches'] as const
const nativeRunners = ['vitest', 'react-scripts', 'jest'] as const
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const diagnostic = (value: string) => stripVTControlCharacters(value).trim().slice(0, 4000)
const emptyMetrics = (): CoverageMetrics => ({ lines: null, statements: null, functions: null, branches: null })

interface CoverageOutput { stdout: string; stderr: string; exitCode: number }
export type TestCoverageRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<CoverageOutput>

/** Kill the process group on limits so test workers cannot outlive a stopped scan. */
const runCoverage: TestCoverageRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let bytes = 0
  let failure: Error | undefined
  const kill = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch { /* The process group already exited. */ }
  }
  const timer = setTimeout(() => {
    failure = Object.assign(new Error('Coverage scan timed out.'), { killed: true })
    kill()
  }, options.timeout ?? 300_000)
  const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > (options.maxBuffer ?? MAX_REPORT_BYTES)) {
      failure = Object.assign(new Error('Coverage output exceeded its limit.'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
      kill()
      return
    }
    if (stream === 'stdout') stdout += chunk.toString('utf8')
    else stderr += chunk.toString('utf8')
  }
  child.stdout.on('data', chunk => collect('stdout', chunk))
  child.stderr.on('data', chunk => collect('stderr', chunk))
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    kill()
    if (failure) reject(failure)
    else if (signal) reject(Object.assign(new Error(`Coverage process stopped with ${signal}.`), { signal }))
    else resolve({ stdout, stderr, exitCode: code ?? 1 })
  })
})

async function readBounded(root: string, filename: string, maxBytes = MAX_REPORT_BYTES): Promise<{ text: string; modifiedAt: string }> {
  const resolvedRoot = await realpath(root)
  const candidate = path.resolve(root, filename)
  if (!isWithin(root, candidate)) throw new Error('Report path is outside the project.')
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Expected a regular report within the size limit.')
  const resolved = await realpath(candidate)
  if (!isWithin(resolvedRoot, resolved)) throw new Error('Report path resolves outside the project.')
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const current = await handle.stat()
    if (!current.isFile() || current.size > maxBytes) throw new Error('Report exceeds the size limit.')
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxBytes) throw new Error('Report exceeds the size limit.')
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), modifiedAt: current.mtime.toISOString() }
  } finally { await handle.close() }
}

function invalidReport(detail = ''): never {
  throw new HelperError(`The coverage report is invalid or unsupported.${detail ? ` ${detail}` : ''} Generate a fresh Istanbul JSON summary or LCOV report and try again.`, 502)
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidReport('Coverage counts must be nonnegative integers.')
  return value as number
}

function metric(total: unknown, covered: unknown): CoverageMetric {
  const totalCount = count(total)
  const coveredCount = count(covered)
  if (coveredCount > totalCount) invalidReport('Covered counts exceed total counts.')
  return { total: totalCount, covered: coveredCount, pct: totalCount ? Math.round(coveredCount / totalCount * 10_000) / 100 : null }
}

function parseMetrics(value: unknown): CoverageMetrics {
  if (!object(value)) invalidReport()
  const result = emptyMetrics()
  for (const key of metricNames) {
    const item = value[key]
    if (!object(item)) invalidReport(`Missing ${key} counts.`)
    result[key] = metric(item.total, item.covered)
  }
  return result
}

function relativeSource(directory: string, filename: string): string | undefined {
  if (!filename || filename.length > 4096 || /[\x00-\x1f]/.test(filename) || /^[a-z]+:\/\//i.test(filename)) invalidReport('Invalid source file path.')
  if (/^[a-z]:[\\/]/i.test(filename) && process.platform !== 'win32') return undefined
  const absolute = path.resolve(directory, filename)
  if (!isWithin(directory, absolute) || absolute === directory) return undefined
  return path.relative(directory, absolute).split(path.sep).join('/')
}

function aggregate(files: TestCoverageReport['files']): CoverageMetrics {
  const result = emptyMetrics()
  for (const name of metricNames) {
    const metrics = files.map(file => file.metrics[name])
    if (!metrics.length || metrics.some(value => value === null)) continue
    result[name] = metric(metrics.reduce((sum, value) => sum + value!.total, 0), metrics.reduce((sum, value) => sum + value!.covered, 0))
  }
  return result
}

interface ParsedCoverage { metrics: CoverageMetrics; files: TestCoverageReport['files']; warnings: string[] }
function parseSummary(text: string, directory: string): ParsedCoverage {
  let value: unknown
  try { value = JSON.parse(text) } catch { invalidReport() }
  if (!object(value) || !object(value.total)) invalidReport('Missing total counts.')
  const totals = parseMetrics(value.total)
  const entries = Object.entries(value).filter(([key]) => key !== 'total')
  if (entries.length > MAX_FILES) invalidReport('The report has too many files.')
  const files: TestCoverageReport['files'] = []
  const seen = new Set<string>()
  let excluded = 0
  for (const [filename, counts] of entries) {
    const metrics = parseMetrics(counts)
    const relative = relativeSource(directory, filename)
    if (!relative) { excluded++; continue }
    if (seen.has(relative)) invalidReport('Duplicate source file paths.')
    seen.add(relative)
    files.push({ path: relative, metrics })
  }
  if (entries.length && !files.length) invalidReport('No reported files belong to this project.')
  const combined = entries.length ? aggregate(files) : totals
  const inconsistent = entries.length > 0 && !excluded && metricNames.some(name => combined[name]?.total !== totals[name]?.total || combined[name]?.covered !== totals[name]?.covered)
  return {
    metrics: combined,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    warnings: [
      ...(!entries.length ? ['This report contains totals only; per-file insights and project scope cannot be verified.'] : []),
      ...(excluded ? [`Excluded ${excluded} report file${excluded === 1 ? '' : 's'} outside the selected project.`] : []),
      ...(inconsistent ? ['Report totals differ from its file counts; coverage was recalculated from the files.'] : []),
    ],
  }
}

function parseLcov(text: string, directory: string): ParsedCoverage {
  const files: TestCoverageReport['files'] = []
  const seen = new Set<string>()
  let current: { filename: string; counts: Record<string, number>; lines: Map<number, boolean> } | undefined
  let excluded = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      if (current) invalidReport('LCOV record is missing end_of_record.')
      current = { filename: line.slice(3), counts: {}, lines: new Map() }
    } else if (line === 'end_of_record') {
      if (!current) invalidReport('LCOV record is missing its source file.')
      const { counts, lines } = current
      const metrics = emptyMetrics()
      for (const [name, totalKey, coveredKey] of [['lines', 'LF', 'LH'], ['functions', 'FNF', 'FNH'], ['branches', 'BRF', 'BRH']] as const) {
        if (counts[totalKey] !== undefined || counts[coveredKey] !== undefined) metrics[name] = metric(counts[totalKey], counts[coveredKey])
      }
      if (lines.size) {
        const lineMetric = metric(lines.size, [...lines.values()].filter(Boolean).length)
        if (metrics.lines && (lineMetric.total !== metrics.lines.total || lineMetric.covered !== metrics.lines.covered)) invalidReport('LCOV line counts are inconsistent.')
        metrics.lines = lineMetric
      }
      if (metricNames.every(name => metrics[name] === null)) invalidReport('LCOV contains no coverage counts.')
      const relative = relativeSource(directory, current.filename)
      if (relative) {
        if (seen.has(relative)) invalidReport('Duplicate LCOV source records; merge them before importing.')
        seen.add(relative)
        files.push({ path: relative, metrics })
      } else excluded++
      if (files.length + excluded > MAX_FILES) invalidReport('The report has too many files.')
      current = undefined
    } else if (current && /^(LF|LH|FNF|FNH|BRF|BRH):/.test(line)) {
      const [key, value] = line.split(':')
      if (!/^\d+$/.test(value) || current.counts[key] !== undefined) invalidReport('Invalid LCOV counts.')
      current.counts[key] = count(Number(value))
    } else if (current && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',')
      if (!/^\d+$/.test(lineNumber) || !/^\d+$/.test(hits) || !count(Number(lineNumber))) invalidReport('Invalid LCOV line data.')
      const covered = count(Number(hits)) > 0
      current.lines.set(Number(lineNumber), current.lines.get(Number(lineNumber)) === true || covered)
    }
  }
  if (current || !files.length) invalidReport('LCOV contains no complete source records for this project.')
  return { metrics: aggregate(files), files: files.sort((a, b) => a.path.localeCompare(b.path)), warnings: [
    'LCOV does not include statement coverage.',
    ...(excluded ? [`Excluded ${excluded} report file${excluded === 1 ? '' : 's'} outside the selected project.`] : []),
  ] }
}

function selectRunner(manifest: Record<string, unknown>): CoverageScriptSelection {
  const scripts = object(manifest.scripts) ? manifest.scripts : {}
  const selected = selectCoverageScript(scripts)
  if (selected) return selected
  const dependencies = { ...(object(manifest.dependencies) ? manifest.dependencies : {}), ...(object(manifest.devDependencies) ? manifest.devDependencies : {}) }
  return { runner: nativeRunners.find(name => typeof dependencies[name] === 'string'), args: [] }
}

function controlledArguments(args: string[], runner: Exclude<CoverageRunner, 'report'>): string[] {
  const owned = new Set(runner === 'vitest'
    ? ['--coverage', '--coverage.enabled', '--coverage.reporter', '--coverage.reportsDirectory', '--coverage.reportOnFailure', '--coverage.thresholds.autoUpdate', '--watch', '-w', '--run', '--update', '-u', '--ui', '--open']
    : ['--coverage', '--collectCoverage', '--coverageReporters', '--coverageDirectory', '--watch', '--watchAll', '--ci', '--updateSnapshot', '-u'])
  const output: string[] = []
  for (let index = 0; index < args.length; index++) {
    const key = args[index].split('=')[0]
    if (owned.has(key)) {
      if (!args[index].includes('=')) {
        if (key === '--coverageReporters') { while (args[index + 1] && !args[index + 1].startsWith('-')) index++ }
        else if (args[index + 1] && (/^(true|false)$/.test(args[index + 1]) || ['--coverage.reporter', '--coverage.reportsDirectory', '--coverageDirectory'].includes(key))) index++
      }
    } else output.push(args[index])
  }
  return output
}

async function installedCli(directory: string, runner: Exclude<CoverageRunner, 'report'>): Promise<{ cli: string; version: string }> {
  try {
    const require = createRequire(path.join(directory, 'package.json'))
    const manifestPath = require.resolve(`${runner}/package.json`)
    const { text } = await readBounded(path.dirname(manifestPath), path.basename(manifestPath), 256 * 1024)
    const manifest: unknown = JSON.parse(text)
    if (!object(manifest)) throw new Error('Invalid runner manifest')
    const bin = typeof manifest.bin === 'string' ? manifest.bin : object(manifest.bin) ? manifest.bin[runner] : undefined
    if (typeof bin !== 'string') throw new Error('Missing runner executable')
    const filename = path.resolve(path.dirname(manifestPath), bin)
    if (!isWithin(path.dirname(manifestPath), filename) || !(await lstat(filename)).isFile()) throw new Error('Invalid runner executable')
    return { cli: filename, version: typeof manifest.version === 'string' ? manifest.version : '' }
  } catch { throw new HelperError(`${runner} is configured but is not installed in this project. Install the project’s test dependencies, then scan again. Local Repos can supply a missing Vitest coverage provider once Vitest itself is installed.`) }
}

/** Keep the built-in provider's reporting/options, but let workers load it from our cache. */
async function coverageBridge(filename: string, modulePath: string): Promise<void> {
  await writeFile(filename, `import providerModule from ${JSON.stringify(pathToFileURL(modulePath).href)};
const wrapperPath = ${JSON.stringify(filename)};
export default {
  ...providerModule,
  startCoverage: providerModule.startCoverage?.bind(providerModule),
  takeCoverage: providerModule.takeCoverage?.bind(providerModule),
  stopCoverage: providerModule.stopCoverage?.bind(providerModule),
  async getProvider() {
    const provider = await providerModule.getProvider();
    const initialize = provider.initialize.bind(provider);
    provider.initialize = async (ctx, ...args) => {
      if (ctx.config?.browser?.enabled || ctx.projects?.some(project => project.config?.browser?.enabled)) {
        throw new Error('Automatic coverage tools currently support Node test suites. For Vitest browser mode, install the matching coverage provider and browser in the project, then scan again.');
      }
      return initialize(ctx, ...args);
    };
    const resolveOptions = provider.resolveOptions.bind(provider);
    provider.resolveOptions = () => ({ ...resolveOptions(), provider: 'custom', customProviderModule: wrapperPath });
    return provider;
  }
};\n`, { flag: 'wx' })
}

function missingCoverageProvider(output: CoverageOutput): 'v8' | 'istanbul' | undefined {
  if (output.exitCode === 0) return
  const match = stripVTControlCharacters(`${output.stderr}\n${output.stdout}`).match(/MISSING DEPENDENCY\s+Cannot find dependency ['"]@vitest\/coverage-(v8|istanbul)['"]/)
  return match?.[1] as 'v8' | 'istanbul' | undefined
}

function withManagedProvider(args: string[], wrapper: string): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index++) {
    const key = args[index].split('=')[0]
    if (key === '--coverage.provider' || key === '--coverage.customProviderModule') {
      if (!args[index].includes('=')) index++
    } else result.push(args[index])
  }
  return [...result, '--coverage.provider=custom', `--coverage.customProviderModule=${wrapper}`]
}

async function existingReport(directory: string, reason?: string): Promise<TestCoverageReport> {
  const candidates = ['coverage/coverage-summary.json', 'coverage-summary.json', 'coverage/lcov.info', 'lcov.info']
  for (const filename of candidates) {
    let report: Awaited<ReturnType<typeof readBounded>>
    try { report = await readBounded(directory, filename) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new HelperError(`Could not read ${filename}. Coverage reports must be regular files inside the project and smaller than 8 MB.`, 502)
    }
    const parsed = filename.endsWith('.json') ? parseSummary(report.text, directory) : parseLcov(report.text, directory)
    return { scannedAt: new Date().toISOString(), runner: 'report', source: 'existing-report', reportPath: filename, reportModifiedAt: report.modifiedAt,
      metrics: parsed.metrics, files: parsed.files,
      warning: diagnostic([`Imported an existing report last modified ${report.modifiedAt}; tests were not run and the report may be stale.`, reason, ...parsed.warnings].filter(Boolean).join('\n')) }
  }
  throw new HelperError(`${reason ? `${reason} ` : ''}No supported coverage report was found. Install and configure Vitest, Jest, or react-scripts, or generate coverage/coverage-summary.json (Istanbul json-summary) or coverage/lcov.info with your existing test setup. Wrappers and other runners use report import.`)
}

/** Run local tests once, or explicitly import a pre-existing report for other setups. */
export async function testCoverageProject(entry: RegisteredProject, runner: TestCoverageRunner = runCoverage, prepareProvider: typeof ensureCoverageProvider = ensureCoverageProvider): Promise<TestCoverageReport> {
  const deadline = Date.now() + 420_000
  let manifest: unknown
  try { manifest = JSON.parse((await readBounded(entry.directory, 'package.json', 256 * 1024)).text) }
  catch { throw new HelperError('Test coverage requires a regular, valid package.json file smaller than 256 KB.') }
  if (!object(manifest)) throw new HelperError('Test coverage requires a valid package.json object.')
  const selection = selectRunner(manifest)
  if (!selection.runner) return existingReport(entry.directory, selection.reason)
  const kind = selection.runner
  const { cli, version } = await installedCli(entry.directory, kind)
  const scanDirectory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-coverage-'))
  const outputDirectory = path.join(scanDirectory, 'reports')
  try {
    await mkdir(outputDirectory)
    let args = [cli, ...(kind === 'vitest' ? ['run'] : kind === 'react-scripts' ? ['test'] : []), ...controlledArguments(selection.args, kind),
      ...(kind === 'vitest'
        ? ['--coverage.enabled', '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${outputDirectory}`, '--coverage.reportOnFailure', '--coverage.thresholds.autoUpdate=false', '--watch=false', '--update=false', '--ui=false', '--open=false']
        : ['--coverage', '--coverageReporters=json-summary', `--coverageDirectory=${outputDirectory}`, '--watch=false', '--watchAll=false', '--ci', '--updateSnapshot=false'])]
    const execute = async () => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new HelperError('Coverage setup and tests exceeded the seven-minute scan limit. Try again to reuse any prepared coverage tools.', 504)
      try {
        return await runner(process.execPath, args, { cwd: entry.directory, encoding: 'utf8', shell: false, timeout: Math.min(300_000, remaining), maxBuffer: MAX_REPORT_BYTES,
          env: { ...process.env, ...selection.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', npm_config_yes: 'false' } })
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('Test coverage exceeded the 8 MB output limit. Reduce test output and try again.', 502)
        if (failure.killed || failure.signal) throw new HelperError('The coverage run stopped or exceeded its five-minute limit. Try a smaller workspace package.', 504)
        throw new HelperError(`Could not start ${kind}. Check project dependencies and test configuration. ${diagnostic(failure.message ?? '')}`, 502)
      }
    }
    let output = await execute()
    let tooling: TestCoverageReport['tooling']
    const missing = kind === 'vitest' ? missingCoverageProvider(output) : undefined
    if (missing) {
      let prepared: Awaited<ReturnType<typeof ensureCoverageProvider>>
      try { prepared = await prepareProvider(missing, version) }
      catch (error) { throw new HelperError(`Could not prepare @vitest/coverage-${missing}@${version} in the Local Repos tool cache. ${diagnostic(error instanceof Error ? error.message : String(error))} Project dependencies were not changed.`, 502) }
      const wrapper = path.join(scanDirectory, 'coverage-provider.mjs')
      await coverageBridge(wrapper, prepared.modulePath)
      args = withManagedProvider(args, wrapper)
      // Only an explicit startup dependency failure is retried. Test failures never trigger setup.
      output = await execute()
      tooling = { packageName: prepared.packageName, version: prepared.version }
    }
    let reportText: string
    try { reportText = (await readBounded(outputDirectory, 'coverage-summary.json')).text }
    catch {
      const detail = diagnostic([output.stderr, output.stdout].filter(Boolean).join('\n'))
      throw new HelperError(`${kind} did not generate a fresh coverage summary (exit ${output.exitCode}).${tooling ? ' Matching coverage tools were prepared; check the test configuration and remaining project dependencies.' : ' Check test failures and coverage configuration.'}${detail ? `\n${detail}` : ''}`, 502)
    }
    const parsed = parseSummary(reportText, entry.directory)
    const warnings = [...parsed.warnings]
    if (output.exitCode !== 0) warnings.unshift(`The test command exited with code ${output.exitCode}. Tests or coverage thresholds failed; this fresh report may be incomplete.`, diagnostic(output.stderr || output.stdout))
    if (!parsed.metrics.lines?.total) warnings.unshift('No executable lines were measured; coverage is unavailable.')
    return { scannedAt: new Date().toISOString(), runner: kind, source: 'run', command: [kind, ...args.slice(1)].join(' ').replaceAll(scanDirectory, '<temporary directory>'), exitCode: output.exitCode, ...(tooling ? { tooling } : {}),
      metrics: parsed.metrics, files: parsed.files, ...(warnings.filter(Boolean).length ? { warning: diagnostic(warnings.filter(Boolean).join('\n')) } : {}) }
  } finally { await rm(scanDirectory, { recursive: true, force: true }) }
}
