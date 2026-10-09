import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { outdatedLevel, scoreVersionGap, sumOutdatedScore } from '../src/lib/outdated'
import type { OutdatedFinding, PackageOutdated, ProjectDependency, RepoProject } from '../src/types'
import { HelperError, type RegisteredProject } from './scanner'

type Manager = RepoProject['packageManager']
type JsonObject = Record<string, unknown>
interface OutdatedOutput { stdout: string; stderr: string; exitCode: number }
export type OutdatedRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<OutdatedOutput>
interface VersionRow { name: string; current?: string; wanted?: string; latest: string; dependentLocation?: string }
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined
const kinds: ProjectDependency['kind'][] = ['peerDependencies', 'devDependencies', 'dependencies', 'optionalDependencies']
const packageName = /^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9_~][a-zA-Z0-9._~-]*$/

export const runOutdatedCommand: OutdatedRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, options, (error, stdout, stderr) => {
    if (error && (typeof error.code !== 'number' || error.killed || error.signal)) { reject(error); return }
    resolve({ stdout, stderr, exitCode: error?.code as number | undefined ?? 0 })
  })
})

function unsupportedReport(): never {
  throw new HelperError('The package manager did not return a complete, supported outdated report. Check its version, lockfile, and registry connection.', 502)
}

function json(value: string): unknown {
  try { return JSON.parse(value) } catch { unsupportedReport() }
}

/** Keep dependency validation and the change-detection baseline on one read. */
export async function readProjectManifest(entry: RegisteredProject) {
  let original: string
  let manifest: unknown
  try {
    const filename = path.join(entry.directory, 'package.json')
    const info = await lstat(filename)
    if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid manifest')
    original = await readFile(filename, 'utf8')
    manifest = JSON.parse(original)
  } catch { throw new HelperError('Outdated scanning requires a regular, valid package.json file smaller than 256 KB.') }
  if (!object(manifest)) throw new HelperError('Outdated scanning requires a valid package.json object.')
  const dependencies = new Map<string, ProjectDependency>()
  for (const kind of kinds) {
    if (manifest[kind] === undefined) continue
    if (!object(manifest[kind])) throw new HelperError(`The package.json ${kind} field must be an object.`)
    for (const [name, version] of Object.entries(manifest[kind])) {
      if (!packageName.test(name) || typeof version !== 'string' || !version.trim()) throw new HelperError('The package.json contains an invalid dependency name or version.')
      dependencies.set(name, { name, version: version.trim(), kind })
    }
  }
  return { original, dependencies, manifest: manifest as Partial<Record<ProjectDependency['kind'], Record<string, string>>> }
}

async function requireLockfile(entry: RegisteredProject): Promise<void> {
  const names: Record<Manager, string[]> = { npm: ['package-lock.json', 'npm-shrinkwrap.json'], pnpm: ['pnpm-lock.yaml'], yarn: ['yarn.lock'], bun: ['bun.lock', 'bun.lockb'] }
  const candidates = names[entry.project.packageManager]
  // Read the small candidate list together, preserving validation/error order.
  const checks = await Promise.allSettled(candidates.map(name => lstat(path.join(entry.workspaceDirectory ?? entry.directory, name))))
  let found = false
  for (const [index, check] of checks.entries()) {
    if (check.status === 'rejected') {
      if ((check.reason as NodeJS.ErrnoException).code !== 'ENOENT') throw check.reason
      continue
    }
    if (!check.value.isFile()) throw new HelperError(`Outdated scanning requires a regular ${candidates[index]} file; linked lockfiles are not supported.`)
    found = true
  }
  if (!found) throw new HelperError(`Outdated scanning requires ${names[entry.project.packageManager].join(' or ')}. Create the lockfile with your package manager first.`)
}

function parseJsonRows(stdout: string): VersionRow[] {
  const report = json(stdout)
  if (!object(report) || report.error || report.type === 'error' || report.code) unsupportedReport()
  const rows: VersionRow[] = []
  for (const [name, values] of Object.entries(report)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (!object(value) || !text(value.latest) || (value.current !== undefined && !text(value.current)) || (value.wanted !== undefined && !text(value.wanted))) unsupportedReport()
      rows.push({ name, current: text(value.current), wanted: text(value.wanted), latest: text(value.latest)!, dependentLocation: typeof value.dependedByLocation === 'string' ? value.dependedByLocation : undefined })
    }
  }
  return rows
}

function parseYarnRows(stdout: string): VersionRow[] {
  const records = stdout.trim().split(/\r?\n/).filter(Boolean).map(json)
  const rows: VersionRow[] = []
  let complete = false
  for (const record of records) {
    if (!object(record)) unsupportedReport()
    if (record.type === 'table' && object(record.data)) {
      const { head, body } = record.data
      if (!Array.isArray(head) || !Array.isArray(body) || !['Package', 'Current', 'Wanted', 'Latest'].every((label, index) => head[index] === label)) unsupportedReport()
      for (const row of body) {
        if (!Array.isArray(row) || row.length !== head.length || !row.slice(0, 4).every(value => text(value))) unsupportedReport()
        const workspaceColumn = head.indexOf('Workspace')
        if (workspaceColumn >= 0 && typeof row[workspaceColumn] !== 'string') unsupportedReport()
        rows.push({ name: row[0], current: row[1], wanted: row[2], latest: row[3], dependentLocation: workspaceColumn >= 0 ? row[workspaceColumn] : undefined })
      }
      complete = true
    } else if (record.type === 'finished' && typeof record.data === 'number') complete = true
    else if (!['info', 'warning', 'step'].includes(String(record.type))) unsupportedReport()
  }
  if (!complete) unsupportedReport()
  return rows
}

function parseBunRows(stdout: string, stderr: string): VersionRow[] {
  // Bun has no JSON outdated format. NO_COLOR produces an ASCII table; clean
  // scans produce no table. Accept only that documented table and its banner.
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const rows: VersionRow[] = []
  let header = false
  for (const line of lines) {
    if (/^bun outdated v\d+\./.test(line) || /^[|+ :\-]+$/.test(line)) continue
    if (!line.startsWith('|') || !line.endsWith('|')) unsupportedReport()
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
    if (cells.length !== 4) unsupportedReport()
    if (cells.join('|') === 'Package|Current|Update|Latest') { header = true; continue }
    if (!header || !cells.every(Boolean)) unsupportedReport()
    rows.push({ name: cells[0].replace(/ \((?:dev|optional|peer)\)$/, ''), current: cells[1], wanted: cells[2], latest: cells[3] })
  }
  return rows
}

function verifyOutput(output: OutdatedOutput, allowOutdatedExit: boolean): void {
  if ((output.exitCode !== 0 && !(allowOutdatedExit && output.exitCode === 1)) || /\b(?:error|failed|skipped|unauthorized|forbidden|ECONN\w*|ENOTFOUND|ETIMEDOUT)\b/i.test(output.stderr)) unsupportedReport()
}

async function modernYarnRows(names: string[], runner: OutdatedRunner, options: ExecFileOptionsWithStringEncoding): Promise<{ rows: VersionRow[]; missing: string[] }> {
  const requestedNames = new Set(names)
  const installed = await runner('yarn', ['info', '--json', ...names], options)
  verifyOutput(installed, false)
  const current = new Map<string, string>()
  for (const record of installed.stdout.trim().split(/\r?\n/).filter(Boolean).map(json)) {
    if (!object(record) || typeof record.value !== 'string' || !object(record.children)) unsupportedReport()
    const name = /^(@[^/]+\/[^@]+|[^@]+)@/.exec(record.value)?.[1]
    const version = text(record.children.Version)
    if (!name || !version) unsupportedReport()
    if (requestedNames.has(name)) current.set(name, version)
  }
  const resolved = names.filter(name => current.has(name))
  if (!resolved.length) unsupportedReport()
  const latest = await runner('yarn', ['npm', 'info', '--json', '--fields', 'name,version', ...resolved.map(name => `${name}@latest`)], options)
  verifyOutput(latest, false)
  const rows: VersionRow[] = []
  const seen = new Set<string>()
  for (const record of latest.stdout.trim().split(/\r?\n/).filter(Boolean).map(json)) {
    if (!object(record) || !text(record.name) || !text(record.version) || !current.has(String(record.name)) || seen.has(String(record.name))) unsupportedReport()
    const name = String(record.name)
    seen.add(name)
    rows.push({ name, current: current.get(name), latest: String(record.version) })
  }
  if (seen.size !== resolved.length) unsupportedReport()
  return { rows, missing: names.filter(name => !current.has(name)) }
}

async function verifyNpmOmissions(names: string[], rows: VersionRow[], skipped: NonNullable<PackageOutdated['skipped']>, runner: OutdatedRunner, options: ExecFileOptionsWithStringEncoding, entry: RegisteredProject): Promise<void> {
  // npm silently omits 404s, unmatched ranges and missing dev/optional packages.
  // An empty outdated object therefore isn't proof that every dependency is current.
  const locked = new Map<string, string>()
  for (const filename of ['npm-shrinkwrap.json', 'package-lock.json']) {
    try {
      const lockPath = path.join(entry.workspaceDirectory ?? entry.directory, filename)
      const info = await lstat(lockPath)
      if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new HelperError('Outdated scanning requires an npm lockfile smaller than 8 MB.', 502)
      const lock: unknown = JSON.parse(await readFile(lockPath, 'utf8'))
      if (!object(lock)) unsupportedReport()
      for (const name of names) {
        const packagePath = entry.workspaceDirectory ? entry.project.monorepo?.packagePath : undefined
        const metadata = object(lock.packages) ? (packagePath ? lock.packages[`${packagePath}/node_modules/${name}`] : undefined) ?? lock.packages[`node_modules/${name}`] : object(lock.dependencies) ? lock.dependencies[name] : undefined
        if (object(metadata) && !metadata.link && text(metadata.version)) locked.set(name, text(metadata.version)!)
      }
      break // npm-shrinkwrap takes precedence over package-lock.
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  for (const row of rows) if (!row.current && locked.has(row.name)) row.current = locked.get(row.name)
  const omitted = names.filter(name => !rows.some(row => row.name === name))
  for (let index = 0; index < omitted.length; index += 4) {
    const results = await Promise.allSettled(omitted.slice(index, index + 4).map(async name => {
      let current: string | undefined
      try {
        const filename = path.join(entry.directory, 'node_modules', name, 'package.json')
        const info = await lstat(filename)
        if (info.isFile() && info.size <= 256 * 1024) {
          const metadata: unknown = JSON.parse(await readFile(filename, 'utf8'))
          if (object(metadata)) current = text(metadata.version)
        }
      } catch { /* Missing or unreadable installations are explicitly unscored. */ }
      current ??= locked.get(name)
      if (!current || scoreVersionGap(current, current) === undefined) {
        skipped.push({ name, reason: 'No comparable installed or locked version is available; resolve this dependency before comparing it.' })
        return
      }
      const latest = await runner('npm', ['view', `${name}@latest`, 'version', '--json', '--ignore-scripts', '--global=false'], options)
      verifyOutput(latest, false)
      const version = json(latest.stdout)
      if (typeof version !== 'string' || !version.trim()) unsupportedReport()
      rows.push({ name, current, latest: version })
    }))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
}

/** Explicit, bounded registry lookups only. Never installs or updates packages. */
export async function outdatedProject(entry: RegisteredProject, runner: OutdatedRunner = runOutdatedCommand): Promise<PackageOutdated> {
  const { dependencies } = await readProjectManifest(entry)
  const manager = entry.project.packageManager
  const skipped: NonNullable<PackageOutdated['skipped']> = []
  const names: string[] = []
  for (const dependency of dependencies.values()) {
    if (dependency.kind === 'peerDependencies') skipped.push({ name: dependency.name, reason: 'A peer-only requirement does not identify a resolved direct dependency.' })
    else if (/[/:#]/.test(dependency.version)) skipped.push({ name: dependency.name, reason: 'Local, workspace, catalog, Git and aliased dependencies are not compared with registry releases.' })
    else names.push(dependency.name)
  }
  const finish = (findings: OutdatedFinding[]): PackageOutdated => ({ manager, scannedAt: new Date().toISOString(), findings, score: sumOutdatedScore(findings), level: outdatedLevel(findings), ...(skipped.length ? { skipped } : {}) })
  if (!names.length) return finish([])
  await requireLockfile(entry)
  if (process.platform === 'win32' && manager !== 'bun') throw new HelperError(`Run the local helper in WSL to scan outdated ${manager} packages. Windows .cmd package-manager launchers are not supported.`, 501)
  const env: NodeJS.ProcessEnv = {
    ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'development',
    COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_ignore_scripts: 'true', npm_config_ignore_pnpmfile: 'true', npm_config_manage_package_manager_versions: 'false',
    PNPM_CONFIG_IGNORE_PNPMFILE: 'true', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false',
    YARN_ENABLE_SCRIPTS: 'false', YARN_ENABLE_TELEMETRY: 'false',
  }
  // Reset inherited selectors so dev and optional dependencies are checked too.
  for (const key of Object.keys(env)) if (/^(?:npm|pnpm)_config_(?:production|dev|only|omit|global|workspace|workspaces|recursive)$/i.test(key)) delete env[key]
  for (const prefix of ['npm_config_', 'pnpm_config_']) for (const key of ['production', 'dev', 'only']) env[`${prefix}${key}`] = 'null'
  const options: ExecFileOptionsWithStringEncoding = { cwd: entry.directory, encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env }
  const commandRunner = runner
  const deadline = Date.now() + 120_000
  runner = (command, args, commandOptions) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(new HelperError('The outdated scan timed out before every dependency could be checked. Try again when the registry is reachable.', 504))
    return commandRunner(command, args, { ...commandOptions, timeout: Math.min(commandOptions.timeout ?? 60_000, remaining) })
  }
  let temporary: string | undefined
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'local-repos-outdated-'))
    env.npm_config_cache = path.join(temporary, 'npm-cache')
    env.pnpm_config_cache_dir = path.join(temporary, 'pnpm-cache')
    env.npm_config_cache_dir = path.join(temporary, 'pnpm-cache')
    env.YARN_INSTALL_STATE_PATH = path.join(temporary, 'install-state.gz')
    env.YARN_CACHE_FOLDER = path.join(temporary, 'yarn-cache')
    env.YARN_GLOBAL_FOLDER = path.join(temporary, 'yarn-global')
    env.YARN_ENABLE_GLOBAL_CACHE = 'false'
    env.YARN_ENABLE_IMMUTABLE_INSTALLS = 'true'
    let rows: VersionRow[]
    let modernYarn = false
    if (manager === 'yarn' || manager === 'bun') {
      const version = await runner(manager, ['--version'], { ...options, timeout: 10_000 })
      const parts = /^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(version.stdout.trim())?.slice(1).map(Number)
      if (version.exitCode || !parts || parts[0] < 1) throw new HelperError(`Could not identify the installed ${manager} version.`, 502)
      if (manager === 'bun' && parts[0] === 1 && parts[1] < 2) throw new HelperError('Outdated scanning requires Bun 1.2.0 or newer.', 502)
      if (manager === 'yarn' && parts[0] === 2 && parts[1] < 3) throw new HelperError('Outdated scanning with modern Yarn requires Yarn 2.3 or newer.', 502)
      modernYarn = manager === 'yarn' && parts[0] >= 2
    }
    if (modernYarn) {
      const result = await modernYarnRows(names, runner, options)
      rows = result.rows
      skipped.push(...result.missing.map(name => ({ name, reason: 'No resolved version was found in the Yarn dependency tree.' })))
    } else {
      const args: Record<Manager, string[]> = {
        npm: ['outdated', '--json', '--long', '--all=false', '--global=false', '--ignore-scripts', '--include=dev', '--include=optional', '--include=peer'],
        pnpm: ['outdated', '--format=json', '--recursive=false', '--global=false', '--compatible=false', '--optional', ...names],
        yarn: ['outdated', '--json', '--non-interactive', '--ignore-scripts', '--production=false', '--cache-folder', path.join(temporary, 'yarn-cache'), ...names],
        bun: ['outdated', '--no-save', '--ignore-scripts', '--no-progress', '--cache-dir', path.join(temporary, 'bun-cache'), ...names],
      }
      if (manager === 'npm' && entry.workspaceDirectory) args.npm.push('--workspace', entry.project.monorepo!.packagePath)
      const output = await runner(manager, args[manager], manager === 'npm' && entry.workspaceDirectory ? { ...options, cwd: entry.workspaceDirectory } : options)
      verifyOutput(output, manager !== 'bun')
      rows = manager === 'yarn' ? parseYarnRows(output.stdout) : manager === 'bun' ? parseBunRows(output.stdout, output.stderr) : parseJsonRows(output.stdout)
      if (output.exitCode === 1 && !rows.length) unsupportedReport()
    }
    if (manager === 'npm') {
      // --workspaces=false incorrectly filters the root out in some npm versions.
      // Keep only root entries from --long output instead of using that selector.
      rows = rows.filter(row => row.dependentLocation === undefined || (entry.workspaceDirectory ? row.dependentLocation === entry.project.monorepo?.packagePath : row.dependentLocation === '' || row.dependentLocation === '.'))
      await verifyNpmOmissions(names, rows, skipped, runner, options, entry)
    }
    // Classic Yarn includes child workspace reports even without recursion.
    if (manager === 'yarn' && !modernYarn) rows = rows.filter(row => row.dependentLocation === undefined || row.dependentLocation === '' || (entry.workspaceDirectory && row.dependentLocation === entry.project.name))
    const findings = new Map<string, OutdatedFinding>()
    const requestedNames = new Set(names)
    for (const row of rows) {
      if (!requestedNames.has(row.name)) continue
      const gap = row.current ? scoreVersionGap(row.current, row.latest) : undefined
      if (gap === undefined) {
        if (!skipped.some(value => value.name === row.name)) skipped.push({ name: row.name, reason: row.current ? 'The current or latest version is not a comparable semantic version.' : 'No resolved current version is available; install this dependency before comparing it.' })
      } else if (gap !== null && (!findings.has(row.name) || findings.get(row.name)!.score < gap.score)) {
        findings.set(row.name, { name: row.name, current: row.current!, wanted: row.wanted, latest: row.latest, kind: dependencies.get(row.name)?.kind, ...gap })
      }
    }
    return finish([...findings.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)))
  } catch (error) {
    if (error instanceof HelperError) throw error
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (failure.code === 'ENOENT') throw new HelperError(`${manager} is not installed or is not on the local helper's PATH.`, 503)
    if (failure.killed || failure.signal) throw new HelperError('The outdated scan timed out or was interrupted. Try again when the registry is reachable.', 504)
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new HelperError('The outdated report exceeded the 8 MB output limit.', 502)
    throw new HelperError(`Could not run ${manager} outdated scanning. Check the installed package manager and registry connection.`, 502)
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
