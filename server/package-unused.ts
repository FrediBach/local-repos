import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { PackageUnused, ProjectDependency, ScanProgressReporter } from '../src/types'
import { HelperError, type RegisteredProject } from './scanner'

const require = createRequire(import.meta.url)
const knipDirectory = path.resolve(path.dirname(require.resolve('knip')), '..')
const knipVersion: string = require(path.join(knipDirectory, 'package.json')).version
const kinds = ['dependencies', 'devDependencies'] as const
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const diagnostic = (value: string) => stripVTControlCharacters(value).trim().slice(0, 4000)

interface KnipOutput { stdout: string; stderr: string; exitCode: number }
export type KnipRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<KnipOutput>
const runKnip: KnipRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, options, (error, stdout, stderr) => {
    if (error && (typeof error.code !== 'number' || error.killed || error.signal)) { reject(error); return }
    resolve({ stdout, stderr, exitCode: error?.code as number | undefined ?? 0 })
  })
})

async function readDependencies(directory: string): Promise<Map<string, ProjectDependency>> {
  let manifest: unknown
  try {
    const filename = path.join(directory, 'package.json')
    const info = await lstat(filename)
    if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid manifest')
    manifest = JSON.parse(await readFile(filename, 'utf8'))
  } catch { throw new HelperError('Unused-package scanning requires a regular, valid package.json file smaller than 256 KB.') }
  if (!object(manifest)) throw new HelperError('Unused-package scanning requires a valid package.json object.')
  const dependencies = new Map<string, ProjectDependency>()
  for (const kind of kinds) {
    const entries = manifest[kind]
    if (entries === undefined) continue
    if (!object(entries)) throw new HelperError(`The package.json ${kind} field must be an object.`)
    for (const [name, version] of Object.entries(entries)) {
      if (!name.trim() || typeof version !== 'string' || !version.trim()) throw new HelperError('The package.json contains an invalid dependency name or version.')
      dependencies.set(`${kind}:${name}`, { name, version, kind })
    }
  }
  return dependencies
}

function invalidReport(): never {
  throw new HelperError('Knip did not return a complete, supported unused-package report. Check the project’s Knip configuration and try again.', 502)
}

/** Run the helper's pinned CLI, without installing tools or applying fixes. */
export async function unusedProject(entry: RegisteredProject, runner: KnipRunner = runKnip, onProgress?: ScanProgressReporter): Promise<PackageUnused> {
  onProgress?.({ phase: 'Reading dependency declarations' })
  const dependencies = await readDependencies(entry.directory)
  // Analyze the whole repository so sibling usage and shared tooling are visible.
  // Report only declarations belonging to the selected project, including at root.
  const cwd = entry.workspaceDirectory ?? entry.directory
  const manifestPath = path.join(entry.directory, 'package.json')
  let output: KnipOutput
  try {
    onProgress?.({ phase: 'Analyzing imports and dependency usage', detail: 'Knip is checking source files, entry points and workspace configuration' })
    output = await runner(process.execPath, [path.join(knipDirectory, 'bin/knip.js'), '--include', 'dependencies', '--reporter', 'json', '--no-progress', '--no-config-hints', '--no-exit-code'], {
      cwd, encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    })
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('Knip’s report exceeded the 8 MB output limit. Narrow the project’s Knip configuration and try again.', 502)
    if (failure.killed || failure.signal) throw new HelperError('The unused-package scan stopped or exceeded its two-minute limit. Try narrowing the project’s Knip configuration.', 504)
    throw new HelperError(`Could not start Knip. Reinstall Local Repos dependencies and try again. ${diagnostic(failure.message ?? '')}`, 502)
  }
  if (output.exitCode !== 0) {
    const detail = diagnostic(output.stderr || output.stdout)
    throw new HelperError(`Knip could not complete the scan. Check that project dependencies are installed and its configuration loads.${detail ? `\n${detail}` : ''}`, 502)
  }
  onProgress?.({ phase: 'Validating and matching unused dependencies', detail: 'Keeping findings for the selected package' })
  let report: unknown
  try { report = JSON.parse(output.stdout) } catch { invalidReport() }
  if (!object(report) || !Array.isArray(report.issues)) invalidReport()
  const findings = new Map<string, PackageUnused['findings'][number]>()
  for (const row of report.issues) {
    if (!object(row) || typeof row.file !== 'string' || !row.file) invalidReport()
    if (!Object.entries(row).some(([key, value]) => key !== 'owners' && Array.isArray(value))) invalidReport()
    for (const kind of kinds) {
      const issues = row[kind]
      // The JSON reporter omits issue types disabled in the project's config.
      if (issues === undefined) continue
      if (!Array.isArray(issues)) invalidReport()
      for (const issue of issues) {
        if (!object(issue) || typeof issue.name !== 'string' || !issue.name.trim()) invalidReport()
        if (issue.line !== undefined && (!Number.isInteger(issue.line) || Number(issue.line) < 1)) invalidReport()
        if (path.resolve(cwd, row.file) !== manifestPath) continue
        const key = `${kind}:${issue.name}`
        const dependency = dependencies.get(key)
        // Reject stale/custom reporter output rather than showing wrong declarations.
        if (!dependency) invalidReport()
        findings.set(key, { ...dependency, ...(issue.line === undefined ? {} : { line: Number(issue.line) }) })
      }
    }
    // Knip also emits referenced optional peers under --include dependencies.
    // They are used packages and must never be labeled as unused.
  }
  const warning = diagnostic(output.stderr)
  return { scannedAt: new Date().toISOString(), knipVersion, findings: [...findings.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), ...(warning ? { warning } : {}) }
}
