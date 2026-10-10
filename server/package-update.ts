import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import type { PackageUpdate, ProjectDependency } from '../src/types'
import { scoreVersionGap } from '../src/lib/outdated'
import { HelperError, type RegisteredProject } from './scanner'
import { outdatedProject, readProjectManifest, runOutdatedCommand, type OutdatedRunner } from './package-outdated'

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

interface UpdateSelection {
  name: string
  acceptsCurrent: (version: string) => boolean
  accepts: (version: string) => boolean
  beforeInstall: () => Promise<void>
}

export function updateTarget(current: string, versions: string[], level: 'minor' | 'patch'): string | undefined {
  if (!stable.test(current)) return
  const [major, minor] = current.split('.').map(Number)
  return versions.filter(version => {
    if (!stable.test(version)) return false
    const parts = version.split('.').map(Number)
    return parts[0] === major && (level === 'minor' || parts[1] === minor) && !!scoreVersionGap(current, version)
  }).sort((a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number)
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
  })[0]
}

export interface PreparedPackageUpdate {
  level: 'minor' | 'patch'
  original: string
  manager: RegisteredProject['project']['packageManager']
  yarnMajor: number
  targets: { name: string; from: string; to: string; kind: ProjectDependency['kind'] }[]
  skipped: PackageUpdate['skipped']
}

function updateCommands(entry: RegisteredProject, runner: OutdatedRunner) {
  const manager = entry.project.packageManager
  const env = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'development',
    COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', npm_config_ignore_scripts: 'true',
    npm_config_ignore_pnpmfile: 'true', PNPM_CONFIG_IGNORE_PNPMFILE: 'true',
    npm_config_manage_package_manager_versions: 'false', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false',
    YARN_ENABLE_SCRIPTS: 'false', YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: 'false',
  } as NodeJS.ProcessEnv
  for (const key of Object.keys(env)) if (/^(?:npm|pnpm)_config_(?:global|workspace|workspaces|recursive|production|dev|only|omit|save.*)$/i.test(key)) delete env[key]
  const options: ExecFileOptionsWithStringEncoding = { cwd: entry.directory, encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env }
  const deadline = Date.now() + 240_000
  const run: OutdatedRunner = async (command, args, config) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new HelperError('Package updates timed out. Check package.json and the lockfile before retrying.', 504)
    const output = await runner(command, args, { ...config, timeout: Math.min(remaining, config.timeout ?? 120_000) })
    if (output.exitCode !== 0) throw new HelperError(`Could not complete ${manager} package updates. Check the registry connection and dependency conflicts. Some files may have changed; resync before retrying.`, 502)
    return output
  }
  return { run, options }
}

/** Resolve exact versions without running an install. */
export async function preparePackageUpdate(entry: RegisteredProject, level: 'minor' | 'patch', runner: OutdatedRunner = runOutdatedCommand, selection?: UpdateSelection): Promise<PreparedPackageUpdate> {
  const manifestPath = path.join(entry.directory, 'package.json')
  const { dependencies, original, manifest } = await readProjectManifest(entry)
  const report = await outdatedProject(entry, runner)
  const manager = entry.project.packageManager
  const result: PackageUpdate = { level, updatedAt: new Date().toISOString(), packages: [], skipped: [] }
  const { run, options } = updateCommands(entry, runner)
  let yarnMajor = 1
  let modernYarn = false
  if (manager === 'yarn') {
    const version = (await run(manager, ['--version'], options)).stdout.trim()
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new HelperError('Could not identify the installed Yarn version.', 502)
    yarnMajor = Number(version.split('.')[0])
    modernYarn = yarnMajor >= 2
  }
  const targets: { name: string; from: string; to: string; kind: ProjectDependency['kind'] }[] = []
  for (const finding of report.findings) {
    if (selection && finding.name !== selection.name) continue
    if (selection && !selection.acceptsCurrent(finding.current)) {
      result.skipped.push({ name: finding.name, reason: 'The selected project’s resolved dependency is not affected by this finding. It may belong to another workspace package.' })
      continue
    }
    const dependency = dependencies.get(finding.name)
    const declarations = (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const).filter(kind => manifest[kind]?.[finding.name] !== undefined)
    if (!dependency || dependency.kind === 'peerDependencies' || declarations.length !== 1 || !/^[~^]?\d+(?:\.\d+){0,2}$/.test(dependency.version) || !stable.test(finding.current)) {
      result.skipped.push({ name: finding.name, reason: 'Only stable registry dependencies with a simple version range in one dependency section are updated.' })
      continue
    }
    const args = manager === 'yarn'
      ? modernYarn ? ['npm', 'info', finding.name, '--fields', 'versions', '--json'] : ['info', finding.name, 'versions', '--json']
      : [manager === 'bun' ? 'info' : 'view', finding.name, 'versions', '--json']
    const output = await run(manager, args, options)
    let versions: unknown
    try {
      const records = output.stdout.trim().split(/\r?\n/).filter(Boolean)
      if (manager === 'yarn' && !modernYarn) versions = records.map(line => JSON.parse(line)).find(record => record.type === 'inspect')?.data
      else { const value = JSON.parse(output.stdout); versions = Array.isArray(value) ? value : value.versions }
    } catch { throw new HelperError(`Could not read published versions for ${finding.name}. No packages were changed.`, 502) }
    if (!Array.isArray(versions) || !versions.every(version => typeof version === 'string')) throw new HelperError(`Could not read published versions for ${finding.name}. No packages were changed.`, 502)
    const to = updateTarget(finding.current, selection ? versions.filter(version => stable.test(version) && selection.accepts(version)) : versions, level)
    if (to) targets.push({ name: finding.name, from: finding.current, to, kind: dependency.kind })
  }
  result.skipped.push(...(report.skipped ?? []).filter(item => !selection || item.name === selection.name))
  // Avoid overwriting edits made while registry requests were in progress.
  if (!(await lstat(manifestPath)).isFile() || await readFile(manifestPath, 'utf8') !== original) throw new HelperError('package.json changed during the update check. Resync and try again.', 409)
  if (targets.length) await selection?.beforeInstall()
  return { level, original, manager, yarnMajor, targets, skipped: result.skipped }
}

/** Install only the resolved targets; never query newer registry versions here. */
export async function applyPackageUpdate(entry: RegisteredProject, plan: PreparedPackageUpdate, runner: OutdatedRunner = runOutdatedCommand, progress?: (group: PreparedPackageUpdate['targets'], completed: boolean) => void): Promise<PackageUpdate> {
  const manifestPath = path.join(entry.directory, 'package.json')
  if (!(await lstat(manifestPath)).isFile() || await readFile(manifestPath, 'utf8') !== plan.original || entry.project.packageManager !== plan.manager) throw new HelperError('Package inputs changed. Prepare a new update.', 409)
  const { manager, yarnMajor, targets, level } = plan
  const modernYarn = yarnMajor >= 2
  const { run, options } = updateCommands(entry, runner)
  const result: PackageUpdate = { level, updatedAt: new Date().toISOString(), packages: [], skipped: plan.skipped }
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const group = targets.filter(target => target.kind === kind)
    if (!group.length) continue
    const specs = group.map(target => `${target.name}@${target.to}`)
    let args: string[]
    let cwd = entry.directory
    if (manager === 'npm') {
      args = ['install', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', '--global=false', kind === 'devDependencies' ? '--save-dev' : kind === 'optionalDependencies' ? '--save-optional' : '--save-prod', ...specs]
      if (entry.workspaceDirectory) { cwd = entry.workspaceDirectory; args.push('--workspace', entry.project.monorepo!.packagePath) }
    } else {
      args = ['add', ...specs, manager === 'pnpm' ? '--save-exact' : '--exact']
      if (kind === 'devDependencies') args.push('--dev')
      if (kind === 'optionalDependencies') args.push('--optional')
      if (manager === 'yarn' && modernYarn) args.push(yarnMajor >= 4 ? '--mode=skip-build' : '--mode=skip-builds')
      else args.push('--ignore-scripts')
      if (manager === 'pnpm') args.push('--ignore-workspace-root-check', '--ignore-pnpmfile')
      if (manager === 'yarn' && !modernYarn) args.push('--non-interactive', '--ignore-workspace-root-check')
    }
    progress?.(group, false)
    await run(manager, args, { ...options, cwd })
    progress?.(group, true)
    result.packages.push(...group)
  }
  return result
}

/** REST uses the same resolution and exact installation services. */
export async function updateProject(entry: RegisteredProject, level: 'minor' | 'patch', runner: OutdatedRunner = runOutdatedCommand, selection?: UpdateSelection): Promise<PackageUpdate> {
  return applyPackageUpdate(entry, await preparePackageUpdate(entry, level, runner, selection), runner)
}
