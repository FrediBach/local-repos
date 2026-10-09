import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCoverageProvider, type CoverageToolRunner } from './coverage-tool-cache'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-provider-test-'))) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

async function installed(directory: string, provider = 'v8', version = '4.1.0') {
  for (const name of [`@vitest/coverage-${provider}`, 'vitest']) {
    const location = path.join(directory, 'node_modules', name)
    await mkdir(path.join(location, 'dist'), { recursive: true })
    await writeFile(path.join(location, 'package.json'), JSON.stringify({ name, version, exports: { '.': { default: './dist/index.js' } } }))
    await writeFile(path.join(location, 'dist/index.js'), 'export default {}')
  }
}

function installer(provider = 'v8', version = '4.1.0') {
  return vi.fn<CoverageToolRunner>(async (_command, _args, options) => {
    await installed(options.cwd as string, provider, version)
    return { stdout: '', stderr: '', exitCode: 0 }
  })
}

describe('isolated Vitest provider cache', () => {
  it('installs exact matching tooling without scripts, then reuses the verified cache', async () => {
    const runner = installer()
    const result = await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })
    expect(result).toEqual({ modulePath: path.join(directory, 'v8-4.1.0/node_modules/@vitest/coverage-v8/dist/index.js'), packageName: '@vitest/coverage-v8', version: '4.1.0' })
    expect(await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })).toEqual(result)
    expect(runner).toHaveBeenCalledTimes(1)
    const [command, args, options] = runner.mock.calls[0]
    expect(command).toBe(process.platform === 'win32' ? 'npm.cmd' : 'npm')
    expect(args).toEqual(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--save-exact', '--registry=https://registry.npmjs.org/', '--global=false', '--workspaces=false', `--prefix=${options.cwd}`, '@vitest/coverage-v8@4.1.0', 'vitest@4.1.0'])
    expect(options).toMatchObject({ shell: false, timeout: 120_000, maxBuffer: 1024 * 1024, env: { CI: '1' } })
    expect(options.cwd).not.toBe(directory)
    await expect(access(options.cwd as string)).rejects.toThrow()
    expect(JSON.parse(await readFile(path.join(directory, 'v8-4.1.0/package.json'), 'utf8')).dependencies).toEqual({ '@vitest/coverage-v8': '4.1.0', vitest: '4.1.0' })
  })

  it('supports exact prereleases and keeps provider/version combinations independent', async () => {
    const v8 = await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner: installer() })
    const istanbul = await ensureCoverageProvider('istanbul', '4.2.0-beta.1', { cacheRoot: directory, runner: installer('istanbul', '4.2.0-beta.1') })
    expect(v8.modulePath).not.toBe(istanbul.modulePath)
    expect(istanbul.modulePath).toContain('istanbul-4.2.0-beta.1/')
  })

  it.each(['latest', '^4.1.0', '>=1', 'v4.1.0', ' 4.1.0', '../4.1.0', '4.1.0;whoami', '4.1.0\n'])('rejects unsafe or non-exact version %j before writing or running npm', async version => {
    const runner = installer()
    await expect(ensureCoverageProvider('v8', version, { cacheRoot: path.join(directory, 'absent'), runner })).rejects.toMatchObject({ code: 'INVALID_VERSION' })
    expect(runner).not.toHaveBeenCalled()
    await expect(access(path.join(directory, 'absent'))).rejects.toThrow()
  })

  it('rejects unsupported providers at runtime', async () => {
    await expect(ensureCoverageProvider('../custom' as 'v8', '4.1.0', { cacheRoot: directory, runner: installer() })).rejects.toMatchObject({ code: 'INVALID_PROVIDER' })
  })

  it('shares one in-flight installation between simultaneous scans', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const runner = vi.fn<CoverageToolRunner>(async (_command, _args, options) => {
      await gate
      await installed(options.cwd as string)
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const first = ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })
    const second = ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })
    release()
    expect(await first).toEqual(await second)
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it.each(['missing-module', 'wrong-version', 'extra-dependency'])('rebuilds a damaged cache (%s)', async damage => {
    const runner = installer()
    const result = await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })
    const destination = path.join(directory, 'v8-4.1.0')
    if (damage === 'missing-module') await rm(result.modulePath)
    if (damage === 'wrong-version') await writeFile(path.join(destination, 'node_modules/vitest/package.json'), JSON.stringify({ name: 'vitest', version: '4.0.0' }))
    if (damage === 'extra-dependency') await writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: 'local-repos-coverage-tools', version: '1.0.0', private: true, dependencies: { '@vitest/coverage-v8': '4.1.0', vitest: '4.1.0', other: '1.0.0' } }))
    expect(await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })).toEqual(result)
    expect(runner).toHaveBeenCalledTimes(2)
    expect(await readdir(directory)).toEqual(['v8-4.1.0'])
  })

  it('never accepts an installation that npm reports as successful with mismatched versions', async () => {
    await expect(ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner: installer('v8', '4.0.0') })).rejects.toMatchObject({ code: 'INVALID_CACHE' })
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects provider entry points escaping the isolated cache', async () => {
    const external = path.join(directory, 'outside.js')
    await writeFile(external, 'export default {}')
    const runner = vi.fn<CoverageToolRunner>(async (_command, _args, options) => {
      await installed(options.cwd as string)
      const modulePath = path.join(options.cwd as string, 'node_modules/@vitest/coverage-v8/dist/index.js')
      await rm(modulePath)
      await symlink(external, modulePath)
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    await expect(ensureCoverageProvider('v8', '4.1.0', { cacheRoot: path.join(directory, 'cache'), runner })).rejects.toMatchObject({ code: 'INVALID_CACHE' })
    expect(await readdir(path.join(directory, 'cache'))).toEqual([])
  })

  it('cleans failed staging and allows a later scan to retry', async () => {
    const runner = installer().mockResolvedValueOnce({ stdout: '', stderr: 'npm error ENOTFOUND registry.npmjs.org', exitCode: 1 })
    await expect(ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringContaining('Check your network') })
    expect(await readdir(directory)).toEqual([])
    await expect(ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })).resolves.toMatchObject({ version: '4.1.0' })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it.each(['ENOTFOUND', 'ETARGET', 'EACCES', 'ERESOLVE', 'unknown'])('never exposes registry or proxy credentials in npm diagnostics (%s)', async code => {
    const runner = installer().mockResolvedValueOnce({ stdout: 'Authorization: Bearer private-token', stderr: `npm error ${code} https://user:private-password@proxy.example/ --token=private-token`, exitCode: 1 })
    let message = ''
    try { await ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner }) } catch (error) { message = (error as Error).message }
    expect(message).toContain('Could not prepare')
    expect(message).not.toContain('private-token')
    expect(message).not.toContain('private-password')
    expect(message).not.toContain('proxy.example')
  })

  it.each([
    [{ killed: true }, 'TIMEOUT', 'two-minute'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'OUTPUT_LIMIT', '1 MB'],
    [{ code: 'ENOENT' }, 'NPM_UNAVAILABLE', 'npm is unavailable'],
    [{ message: 'ETARGET No matching version found' }, 'VERSION_UNAVAILABLE', 'matching published provider'],
    [{ message: 'Unknown npm failure' }, 'INSTALL_FAILED', 'Retry the scan'],
  ])('explains failed installs and leaves no reusable partial entry', async (failure, code, message) => {
    const runner = installer().mockRejectedValueOnce(failure)
    await expect(ensureCoverageProvider('v8', '4.1.0', { cacheRoot: directory, runner })).rejects.toMatchObject({ code, message: expect.stringContaining(message) })
    expect(await readdir(directory)).toEqual([])
  })
})
