import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import type { ReactDoctorFinding, ReactDoctorReport, ScanProgressReporter } from '../src/types'
import { HelperError, type RegisteredProject } from './scanner'
import { observeScanProgress, withoutScanProgress } from './scan-worker-progress'

const require = createRequire(import.meta.url)
const doctorDirectory = path.resolve(path.dirname(require.resolve('react-doctor')), '..')
const doctorVersion: string = require(path.join(doctorDirectory, 'package.json')).version
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const diagnostic = (value: string) => stripVTControlCharacters(value).trim().slice(0, 4000)
const reactDependencies = new Set(['react', 'react-dom', 'react-native', 'next', 'expo'])

interface ReactDoctorOutput { stdout: string; stderr: string; exitCode: number }
export type ReactDoctorRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<ReactDoctorOutput>
const progressObserver = fileURLToPath(new URL('./react-doctor-progress.mjs', import.meta.url))
const createReactDoctorRunner = (onProgress?: ScanProgressReporter): ReactDoctorRunner => (command, args, options) => new Promise((resolve, reject) => {
  const child = execFile(command, onProgress ? ['--import', progressObserver, ...args] : args, options, (error, stdout, stderr) => {
    if (error && (typeof error.code !== 'number' || error.killed || error.signal)) { reject(error); return }
    resolve({ stdout, stderr: withoutScanProgress(stderr), exitCode: error?.code as number | undefined ?? 0 })
  })
  if (onProgress) observeScanProgress(child.stderr, onProgress)
})
const runReactDoctor = createReactDoctorRunner()

async function requireReactProject(directory: string): Promise<void> {
  let manifest: unknown
  try {
    const filename = path.join(directory, 'package.json')
    const info = await lstat(filename)
    if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid manifest')
    manifest = JSON.parse(await readFile(filename, 'utf8'))
  } catch { throw new HelperError('React Doctor requires a regular, valid package.json file smaller than 256 KB.') }
  if (!object(manifest)) throw new HelperError('React Doctor requires a valid package.json object.')
  for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = manifest[kind]
    if (dependencies === undefined) continue
    if (!object(dependencies)) throw new HelperError(`The package.json ${kind} field must be an object.`)
    if (Object.entries(dependencies).some(([name, version]) => reactDependencies.has(name) && typeof version === 'string' && version.trim())) return
  }
  throw new HelperError('React Doctor is available for projects that declare React or a React framework in package.json.')
}

function invalidReport(): never {
  throw new HelperError('React Doctor did not return a complete, supported report for this project. Check its React Doctor configuration and try again.', 502)
}

function parseFinding(value: unknown): ReactDoctorFinding {
  if (!object(value)
    || !['filePath', 'plugin', 'rule', 'message', 'help', 'category'].every(key => typeof value[key] === 'string')
    || !value.rule || !value.message
    || !Number.isInteger(value.line) || Number(value.line) < 0
    || !Number.isInteger(value.column) || Number(value.column) < 0
    || (value.severity !== 'error' && value.severity !== 'warning')
    || (value.url !== undefined && typeof value.url !== 'string')) invalidReport()
  return {
    filePath: value.filePath as string, plugin: value.plugin as string, rule: value.rule as string,
    message: value.message as string, help: value.help as string, category: value.category as string,
    line: Number(value.line), column: Number(value.column), severity: value.severity,
    ...(typeof value.url === 'string' && /^https?:\/\//i.test(value.url) ? { url: value.url } : {}),
  }
}

/** Use the installed CLI, force a full scan, and select only this card's project. */
export async function reactDoctorProject(entry: RegisteredProject, runner: ReactDoctorRunner = runReactDoctor, onProgress?: ScanProgressReporter): Promise<ReactDoctorReport> {
  onProgress?.({ phase: 'Checking the React project manifest' })
  await requireReactProject(entry.directory)
  if (onProgress && runner === runReactDoctor) runner = createReactDoctorRunner(onProgress)
  let output: ReactDoctorOutput
  try {
    onProgress?.({ phase: 'Loading React Doctor configuration and source files' })
    output = await runner(process.execPath, [path.join(doctorDirectory, 'bin/react-doctor.js'), entry.directory,
      '--project', '.', '--json', '--json-compact', '--scope', 'full', '--lint', '--dead-code', '--warnings',
      '--blocking', 'none', '--no-supply-chain', '--no-cache', '--yes'], {
      cwd: entry.directory, encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', REACT_DOCTOR_PARALLEL: '2' },
    })
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('React Doctor’s report exceeded the 8 MB output limit. Narrow the project’s React Doctor configuration and try again.', 502)
    if (failure.killed || failure.signal) throw new HelperError('The React Doctor scan stopped or exceeded its two-minute limit. Try scanning a smaller workspace package.', 504)
    throw new HelperError(`Could not start React Doctor. Reinstall Local Repos dependencies and try again. ${diagnostic(failure.message ?? '')}`, 502)
  }
  if (output.exitCode !== 0) {
    const detail = diagnostic(output.stderr || output.stdout)
    throw new HelperError(`React Doctor could not complete the scan. Check that project dependencies are installed and its configuration loads.${detail ? `\n${detail}` : ''}`, 502)
  }
  onProgress?.({ phase: 'Validating React Doctor findings and score' })
  let report: unknown
  try { report = JSON.parse(output.stdout) } catch { invalidReport() }
  if (!object(report) || report.schemaVersion !== 3 || report.mode !== 'full' || report.ok !== true || report.error !== null
    || !Array.isArray(report.projects) || report.projects.length !== 1 || !Array.isArray(report.diagnostics)
    || !object(report.summary) || report.version !== doctorVersion
    || (report.skippedProjects !== undefined && (!Array.isArray(report.skippedProjects) || report.skippedProjects.length))) invalidReport()
  const project = report.projects[0]
  if (!object(project) || typeof project.directory !== 'string' || path.resolve(project.directory) !== entry.directory
    || !Array.isArray(project.diagnostics) || !Array.isArray(project.skippedChecks)
    || !project.skippedChecks.every(check => typeof check === 'string') || typeof project.complete !== 'boolean'
    || !Number.isInteger(project.scannedFileCount) || Number(project.scannedFileCount) < 0
    || !Number.isInteger(project.analyzedFileCount) || Number(project.analyzedFileCount) < 0
    || !Array.isArray(project.analyzedFiles) || !project.analyzedFiles.every(file => typeof file === 'string')
    || project.analyzedFiles.length !== project.analyzedFileCount
    || (project.skippedCheckReasons !== undefined && (!object(project.skippedCheckReasons) || !Object.values(project.skippedCheckReasons).every(reason => typeof reason === 'string')))) invalidReport()
  const findings = project.diagnostics.map(parseFinding)
  const { score, scoreLabel } = report.summary
  if ((score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100))
    || (scoreLabel !== null && typeof scoreLabel !== 'string') || (score !== null && !scoreLabel)
    || report.summary.totalDiagnosticCount !== findings.length || report.diagnostics.length !== findings.length
    || report.summary.errorCount !== findings.filter(finding => finding.severity === 'error').length
    || report.summary.warningCount !== findings.filter(finding => finding.severity === 'warning').length) invalidReport()
  const warnings: string[] = []
  const reasons = object(project.skippedCheckReasons) ? Object.values(project.skippedCheckReasons) as string[] : []
  const incomplete = !project.complete || project.skippedChecks.length > 0 || reasons.length > 0 || project.analyzedFileCount !== project.scannedFileCount
  const noSource = project.scannedFileCount === 0
  if (incomplete) warnings.push(`Some checks did not finish; these findings may be incomplete.${reasons.length ? ` ${reasons.join(' ')}` : project.skippedChecks.length ? ` Skipped checks: ${project.skippedChecks.join(', ')}.` : ''}`)
  if (noSource) warnings.push('React Doctor found no supported source files to analyze.')
  if (!incomplete && !noSource && score === null) warnings.push('The React Doctor score is unavailable. Its scoring service may be unreachable, or scoring may be disabled in the project’s configuration. The findings are still available.')
  if (diagnostic(output.stderr)) warnings.push(diagnostic(output.stderr))
  return {
    scannedAt: new Date().toISOString(), version: doctorVersion,
    score: incomplete || noSource ? null : score as number | null,
    label: incomplete ? 'Incomplete scan' : noSource || score === null ? 'Score unavailable' : scoreLabel as string,
    findings: findings.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error') || a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule)),
    ...(warnings.length ? { warning: diagnostic(warnings.join('\n')) } : {}),
  }
}
