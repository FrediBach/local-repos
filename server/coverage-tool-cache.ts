import { spawn, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { valid } from 'semver'

const INSTALL_TIMEOUT = 120_000
const MAX_OUTPUT = 1024 * 1024
const REGISTRY = 'https://registry.npmjs.org/'
const CACHE_ROOT = path.join(os.tmpdir(), 'local-repos-coverage-tools', 'v1')

export interface CachedCoverageProvider { modulePath: string; packageName: string; version: string }
interface InstallOutput { stdout: string; stderr: string; exitCode: number }
export type CoverageToolRunner = (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<InstallOutput>
export interface CoverageToolCacheOptions { cacheRoot?: string; runner?: CoverageToolRunner }

export class CoverageProviderSetupError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'CoverageProviderSetupError'
  }
}

const pending = new Map<string, Promise<CachedCoverageProvider>>()
const within = (root: string, filename: string) => {
  const relative = path.relative(root, filename)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Bound npm and its subprocesses, including a stalled network connection. */
const runNpm: CoverageToolRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let bytes = 0
  let failure: Error | undefined
  const kill = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch { /* Already exited. */ }
  }
  const timer = setTimeout(() => {
    failure = Object.assign(new Error('Provider download timed out.'), { killed: true })
    kill()
  }, INSTALL_TIMEOUT)
  const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > MAX_OUTPUT) {
      failure = Object.assign(new Error('Provider download output exceeded its limit.'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
      kill()
      return
    }
    if (stream === 'stdout') stdout += chunk.toString('utf8')
    else stderr += chunk.toString('utf8')
  }
  child.stdout.on('data', chunk => collect('stdout', chunk))
  child.stderr.on('data', chunk => collect('stderr', chunk))
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('close', (exitCode, signal) => {
    clearTimeout(timer)
    kill()
    if (failure) reject(failure)
    else if (signal) reject(new Error(`Provider download stopped with ${signal}.`))
    else resolve({ stdout, stderr, exitCode: exitCode ?? 1 })
  })
})

function installError(error: unknown, packageName: string, version: string): CoverageProviderSetupError {
  const failure = error as { code?: string; killed?: boolean; message?: string; stderr?: string; stdout?: string }
  const output = stripVTControlCharacters([failure?.message, failure?.stderr, failure?.stdout].filter(Boolean).join('\n')).trim().slice(-1800)
  const prefix = `Could not prepare ${packageName}@${version} in the shared coverage cache.`
  if (failure?.killed) return new CoverageProviderSetupError(`${prefix} The download exceeded the two-minute limit. Check your connection and retry.`, 'TIMEOUT')
  if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new CoverageProviderSetupError(`${prefix} npm exceeded the 1 MB output limit.`, 'OUTPUT_LIMIT')
  if (failure?.code === 'ENOENT') return new CoverageProviderSetupError(`${prefix} npm is unavailable. Install Node.js with npm, then restart the helper.`, 'NPM_UNAVAILABLE')
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|CERT_|certificate|E401|E403/i.test(output)) {
    return new CoverageProviderSetupError(`${prefix} npm could not reach ${REGISTRY} successfully. Check your network, proxy, and registry access, then retry.`, 'NETWORK')
  }
  if (/ETARGET|E404|No matching version|Not Found/i.test(output)) {
    return new CoverageProviderSetupError(`${prefix} A matching published provider version was not found. Update Vitest or install a compatible provider in the project.`, 'VERSION_UNAVAILABLE')
  }
  if (/\b(?:EACCES|EPERM|ENOSPC)\b/.test(output)) return new CoverageProviderSetupError(`${prefix} npm could not write its installation or download cache. Check available disk space and cache-directory permissions, then retry.`, 'FILESYSTEM')
  // npm diagnostics can contain credentials from registry and proxy configuration.
  // Keep only known, useful error codes; never forward arbitrary npm output.
  const code = output.match(/\b(EBADENGINE|ERESOLVE|EINTEGRITY)\b/)?.[1]
  return new CoverageProviderSetupError(`${prefix}${code ? ` npm reported ${code}.` : ''} Retry the scan or install the matching provider in your project.`, 'INSTALL_FAILED')
}

async function readManifest(filename: string): Promise<Record<string, unknown>> {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Invalid cached package manifest.')
  const manifest: unknown = JSON.parse(await readFile(filename, 'utf8'))
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new Error('Invalid cached package manifest.')
  return manifest as Record<string, unknown>
}

async function validate(directory: string, packageName: string, version: string): Promise<CachedCoverageProvider> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid coverage cache directory.')
  const resolvedRoot = await realpath(directory)
  const manifest = await readManifest(path.join(directory, 'package.json'))
  const dependencies = manifest.dependencies
  if (manifest.name !== 'local-repos-coverage-tools' || manifest.version !== '1.0.0' || manifest.private !== true
    || Object.keys(manifest).some(key => !['name', 'version', 'private', 'dependencies'].includes(key))
    || typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)
    || Object.keys(dependencies).length !== 2 || (dependencies as Record<string, unknown>)[packageName] !== version
    || (dependencies as Record<string, unknown>).vitest !== version) {
    throw new Error('Invalid coverage cache dependencies.')
  }
  for (const name of [packageName, 'vitest']) {
    const filename = path.join(directory, 'node_modules', name, 'package.json')
    if (!within(resolvedRoot, await realpath(filename))) throw new Error('Cached package resolves outside the coverage cache.')
    const installed = await readManifest(filename)
    if (installed.name !== name || installed.version !== version) throw new Error('Cached provider and Vitest versions do not match.')
  }
  const modulePath = createRequire(path.join(directory, 'package.json')).resolve(packageName)
  const moduleInfo = await lstat(modulePath)
  if (!moduleInfo.isFile() || moduleInfo.isSymbolicLink() || !within(resolvedRoot, await realpath(modulePath))) throw new Error('Invalid cached provider module.')
  return { modulePath, packageName, version }
}

async function prepare(provider: 'v8' | 'istanbul', version: string, cacheRoot: string, runner: CoverageToolRunner): Promise<CachedCoverageProvider> {
  const packageName = `@vitest/coverage-${provider}`
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  const rootInfo = await lstat(cacheRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new CoverageProviderSetupError('The coverage cache must be a regular directory.', 'INVALID_CACHE')
  const destination = path.join(cacheRoot, `${provider}-${version}`)
  try { return await validate(destination, packageName, version) } catch { /* Missing or damaged entries are rebuilt. */ }
  const staging = await mkdtemp(path.join(cacheRoot, `.install-${provider}-${version}-`))
  try {
    await writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: 'local-repos-coverage-tools', private: true, version: '1.0.0', dependencies: { [packageName]: version, vitest: version } }))
    let output: InstallOutput
    try {
      output = await runner(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
        'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--save-exact', `--registry=${REGISTRY}`,
        '--global=false', '--workspaces=false', `--prefix=${staging}`,
        `${packageName}@${version}`, `vitest@${version}`,
      ], {
        cwd: staging, encoding: 'utf8', shell: false, timeout: INSTALL_TIMEOUT, maxBuffer: MAX_OUTPUT,
        env: { ...process.env, CI: '1', NO_COLOR: '1', npm_config_progress: 'false', npm_config_update_notifier: 'false' },
      })
    } catch (error) { throw installError(error, packageName, version) }
    if (output.exitCode !== 0) throw installError(output, packageName, version)
    try { await validate(staging, packageName, version) } catch {
      throw new CoverageProviderSetupError(`npm did not produce a valid ${packageName}@${version} installation. Retry the scan or install the matching provider in your project.`, 'INVALID_CACHE')
    }
    try { await rename(staging, destination) } catch (error) {
      // Another helper may have finished the same installation while npm was running.
      try { return await validate(destination, packageName, version) } catch { /* Replace only an invalid entry. */ }
      if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      await rm(destination, { recursive: true, force: true })
      try { await rename(staging, destination) } catch (publishError) {
        try { return await validate(destination, packageName, version) } catch { throw publishError }
      }
    }
    return await validate(destination, packageName, version)
  } finally { await rm(staging, { recursive: true, force: true }) }
}

/** Install matching provider tooling outside the scanned project and reuse it across scans. */
export async function ensureCoverageProvider(provider: 'v8' | 'istanbul', version: string, options: CoverageToolCacheOptions = {}): Promise<CachedCoverageProvider> {
  if (provider !== 'v8' && provider !== 'istanbul') throw new CoverageProviderSetupError('Unsupported Vitest coverage provider.', 'INVALID_PROVIDER')
  if (typeof version !== 'string' || valid(version) !== version) throw new CoverageProviderSetupError('Coverage requires an exact installed Vitest version, such as 4.1.0. Version tags and ranges are unsupported.', 'INVALID_VERSION')
  const cacheRoot = path.resolve(options.cacheRoot ?? CACHE_ROOT)
  const key = JSON.stringify([cacheRoot, provider, version])
  const existing = pending.get(key)
  if (existing) return existing
  const installation = prepare(provider, version, cacheRoot, options.runner ?? runNpm)
  pending.set(key, installation)
  try { return await installation } finally { pending.delete(key) }
}
