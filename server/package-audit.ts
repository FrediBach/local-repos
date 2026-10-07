import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AuditFinding, AuditSeverity, PackageAudit, RepoProject } from '../src/types'
import { HelperError, type RegisteredProject } from './scanner'

type Manager = RepoProject['packageManager']
type JsonObject = Record<string, unknown>
interface AuditOutput { stdout: string; stderr: string; exitCode: number }
export type AuditRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<AuditOutput>

const severities: AuditSeverity[] = ['info', 'low', 'moderate', 'high', 'critical']
const emptyCounts = (): PackageAudit['counts'] => ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 })
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined
const severity = (value: unknown): value is AuditSeverity => typeof value === 'string' && severities.includes(value as AuditSeverity)
const versionParts = (value: string): number[] | undefined => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())?.slice(1).map(Number)

const runAuditCommand: AuditRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, options, (error, stdout, stderr) => {
    // Vulnerabilities intentionally produce nonzero exits. A killed process or
    // truncated buffer must never be mistaken for a complete vulnerability report.
    if (error && (typeof error.code !== 'number' || error.killed || error.signal)) {
      reject(error)
      return
    }
    resolve({ stdout, stderr, exitCode: error?.code as number | undefined ?? 0 })
  })
})

function unsupportedReport(): never {
  throw new HelperError('The package manager did not return a complete, supported audit report. Check its version, lockfile, and registry connection.', 502)
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

function countsFrom(value: unknown): PackageAudit['counts'] {
  if (!object(value)) unsupportedReport()
  const counts = emptyCounts()
  for (const key of severities) {
    if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0) unsupportedReport()
    counts[key] = value[key]
  }
  return counts
}

function advisoryFinding(value: unknown, fallbackName?: string): AuditFinding {
  if (!object(value) || !severity(value.severity)) unsupportedReport()
  const name = text(value.module_name) ?? text(value.name) ?? fallbackName
  const title = text(value.title)
  if (!name || !title) unsupportedReport()
  return {
    name, title, severity: value.severity,
    range: text(value.vulnerable_versions) ?? text(value.range),
    url: safeUrl(value.url),
    fixAvailable: value.patched_versions === null ? false : typeof value.patched_versions === 'string' ? !['<0.0.0', ''].includes(value.patched_versions) : undefined,
  }
}

function parseReport(stdout: string, format: 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-modern' | 'bun'): Pick<PackageAudit, 'counts' | 'findings'> {
  let records: unknown[]
  try { records = [JSON.parse(stdout)] } catch {
    try { records = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) } catch { unsupportedReport() }
  }
  if (!records.length) unsupportedReport()
  const findings: AuditFinding[] = []
  let counts: PackageAudit['counts'] | undefined
  let recognized = false
  const seen = new Set<string>()
  const add = (finding: AuditFinding) => {
    const key = JSON.stringify([finding.name, finding.severity, finding.title, finding.range, finding.url])
    if (!seen.has(key)) { seen.add(key); findings.push(finding) }
  }
  for (const record of records) {
    if (!object(record)) unsupportedReport()
    if (record.error || record.type === 'error' || (typeof record.code === 'string' && record.code.startsWith('ERR_'))) unsupportedReport()
    if (object(record.vulnerabilities)) {
      // npm v7+: the summary counts affected packages, including packages that
      // inherit a vulnerability from a transitive dependency.
      for (const [name, value] of Object.entries(record.vulnerabilities)) {
        if (!object(value) || !severity(value.severity) || !Array.isArray(value.via)) unsupportedReport()
        const advisories = value.via.filter(object)
        const titles = advisories.map(advisory => text(advisory.title)).filter(Boolean)
        add({
          name: text(value.name) ?? name, severity: value.severity,
          title: titles.length ? titles.join('; ') : 'Depends on a vulnerable package',
          range: text(value.range), url: safeUrl(advisories.find(advisory => typeof advisory.url === 'string')?.url),
          direct: typeof value.isDirect === 'boolean' ? value.isDirect : undefined,
          fixAvailable: typeof value.fixAvailable === 'boolean' ? value.fixAvailable : object(value.fixAvailable) ? true : undefined,
        })
      }
      if (!object(record.metadata)) unsupportedReport()
      counts = countsFrom(record.metadata.vulnerabilities)
      recognized = true
    } else if (object(record.advisories)) {
      // npm v6, pnpm, and older modern Yarn versions use advisory maps.
      Object.values(record.advisories).forEach(value => add(advisoryFinding(value)))
      if (!object(record.metadata)) unsupportedReport()
      counts = countsFrom(record.metadata.vulnerabilities)
      recognized = true
    } else if (format === 'yarn-classic') {
      if (record.type === 'auditAdvisory' && object(record.data)) add(advisoryFinding(record.data.advisory))
      else if (record.type === 'auditSummary' && object(record.data)) {
        counts = countsFrom(record.data.vulnerabilities)
        recognized = true
      } else if (!['info', 'warning', 'step', 'success', 'finished'].includes(String(record.type))) unsupportedReport()
    } else if (format === 'yarn-modern' && object(record.children)) {
      const children = record.children
      add(advisoryFinding({
        name: record.value, title: children.Issue, severity: children.Severity,
        vulnerable_versions: children['Vulnerable Versions'], url: children.URL,
      }))
      recognized = true
    } else if (format === 'yarn-modern' && record.type === 'info' && record.data === 'No audit suggestions') {
      recognized = true
    } else if (format === 'yarn-modern' || format === 'bun') {
      // The bulk registry response maps package names to advisory arrays. An
      // empty object is a valid clean result only for these raw-report formats.
      for (const [name, values] of Object.entries(record)) {
        if (!Array.isArray(values)) unsupportedReport()
        values.forEach(value => add(advisoryFinding(value, name)))
      }
      recognized = true
    } else unsupportedReport()
  }
  if (!recognized) unsupportedReport()
  const findingCounts = emptyCounts()
  findings.forEach(finding => { findingCounts[finding.severity]++ })
  if (counts && severities.some(key => findingCounts[key] > 0 && counts[key] === 0)) unsupportedReport()
  return { counts: counts ?? findingCounts, findings: findings.sort((a, b) => severities.indexOf(b.severity) - severities.indexOf(a.severity) || a.name.localeCompare(b.name)) }
}

async function hasRegularFile(directory: string, filename: string): Promise<boolean> {
  try { return (await lstat(path.join(directory, filename))).isFile() } catch { return false }
}

async function requireLockfile(entry: RegisteredProject): Promise<void> {
  if (!await hasRegularFile(entry.directory, 'package.json')) throw new HelperError('This project needs a regular package.json file before it can be audited.')
  const lockfiles: Record<Manager, string[]> = {
    npm: ['package-lock.json', 'npm-shrinkwrap.json'], pnpm: ['pnpm-lock.yaml'], yarn: ['yarn.lock'], bun: ['bun.lock'],
  }
  const names = lockfiles[entry.project.packageManager]
  for (const name of names) {
    try {
      const info = await lstat(path.join(entry.directory, name))
      if (!info.isFile()) throw new HelperError(`Audit requires a regular ${name} file; linked lockfiles are not supported.`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!(await Promise.all(names.map(name => hasRegularFile(entry.directory, name)))).some(Boolean)) {
    throw new HelperError(`Audit requires ${names.join(' or ')} in this project. ${entry.project.packageManager === 'bun' ? 'Binary bun.lockb files are not supported by this audit action.' : 'Create the lockfile with your package manager first.'}`)
  }
}

/** Runs only when explicitly requested; never installs dependencies or applies fixes. */
export async function auditProject(entry: RegisteredProject, runner: AuditRunner = runAuditCommand): Promise<PackageAudit> {
  await requireLockfile(entry)
  const manager = entry.project.packageManager
  if (process.platform === 'win32' && manager !== 'bun') {
    throw new HelperError(`Run the local helper in WSL to audit ${manager} projects. Windows .cmd package-manager launchers are not supported.`, 501)
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'development',
    COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_ignore_scripts: 'true', npm_config_ignore_pnpmfile: 'true', npm_config_manage_package_manager_versions: 'false',
    PNPM_CONFIG_IGNORE_PNPMFILE: 'true', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false',
    YARN_ENABLE_SCRIPTS: 'false', YARN_ENABLE_TELEMETRY: 'false',
  }
  const options: ExecFileOptionsWithStringEncoding = {
    cwd: entry.directory, encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env,
  }
  let temporary: string | undefined
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'local-repos-audit-'))
    env.npm_config_cache = path.join(temporary, 'npm-cache')
    let format: Parameters<typeof parseReport>[1] = manager === 'yarn' ? 'yarn-classic' : manager
    let args = ['audit', '--json']
    if (manager === 'npm') args.push('--package-lock-only', '--ignore-scripts', '--include=dev', '--include=optional', '--include=peer')
    if (manager === 'pnpm') {
      args.push('--audit-level=info', '--optional')
      // pnpm treats --prod and --dev as exclusive selectors; passing both
      // chooses production. Its older config schema uses null (not false) to
      // reset these selectors. Environment settings override .npmrc/YAML, and
      // pnpm 12 audits both groups when neither CLI selector is present.
      for (const key of Object.keys(env)) {
        if (/^(?:npm|pnpm)_config_(?:production|dev|only)$/i.test(key)) delete env[key]
      }
      for (const prefix of ['npm_config_', 'pnpm_config_']) {
        for (const key of ['production', 'dev', 'only']) env[`${prefix}${key}`] = 'null'
      }
    }
    if (manager === 'bun') {
      // Older Bun versions treat an unknown command as a package script. Check
      // the built-in command's minimum version before ever invoking "audit".
      const version = await runner(manager, ['--version'], { ...options, timeout: 10_000 })
      const parts = versionParts(version.stdout)
      if (version.exitCode !== 0 || !parts || parts[0] < 1 || (parts[0] === 1 && (parts[1] < 2 || (parts[1] === 2 && parts[2] < 15)))) {
        throw new HelperError('Package auditing requires Bun 1.2.15 or newer.', 502)
      }
    }
    if (manager === 'yarn') {
      const version = await runner(manager, ['--version'], { ...options, timeout: 10_000 })
      const parts = versionParts(version.stdout)
      if (version.exitCode !== 0 || !parts || parts[0] < 1) throw new HelperError('Could not identify the installed Yarn version. Install Yarn before running an audit.', 502)
      const major = parts[0]
      if (major === 1 && parts[1] < 16) throw new HelperError('Classic Yarn auditing requires Yarn 1.16 or newer.', 502)
      if (major === 2 && parts[1] < 4) throw new HelperError('Modern Yarn auditing requires Yarn 2.4 or newer.', 502)
      if (major >= 2) {
        format = 'yarn-modern'
        args = ['npm', 'audit', '--json', '--all', '--recursive', '--environment', 'all']
        // Yarn may regenerate its install-state cache during a read-only audit.
        // Redirect that cache to a disposable folder rather than the repository.
        env.YARN_INSTALL_STATE_PATH = path.join(temporary, 'install-state.gz')
        if (major >= 4) args.push('--no-deprecations')
      } else args.push('--non-interactive', '--ignore-scripts', '--production=false', '--groups', 'dependencies devDependencies optionalDependencies')
    }
    const output = await runner(manager, args, options)
    // A partial or failed registry request must not appear as a clean report.
    if (/audit request failed|\bunaudited\b|\bskipped\b/i.test(output.stderr)) unsupportedReport()
    const result = parseReport(output.stdout, format)
    const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0)
    const validExit = output.exitCode === 0 || (total > 0 && (format === 'yarn-classic' ? output.exitCode >= 1 && output.exitCode <= 31 : output.exitCode === 1))
    if (!validExit) unsupportedReport()
    return { manager, scannedAt: new Date().toISOString(), ...result }
  } catch (error) {
    if (error instanceof HelperError) throw error
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (failure.code === 'ENOENT') throw new HelperError(`${manager} is not installed or is not on the local helper's PATH.`, 503)
    if (failure.killed || failure.signal) throw new HelperError('The package audit timed out or was interrupted. Try again when the registry is reachable.', 504)
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('The package audit report exceeded the 8 MB output limit.', 502)
    throw new HelperError(`Could not run ${manager} audit. Check the installed package manager and registry connection.`, 502)
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
