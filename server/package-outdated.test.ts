import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoProject } from '../src/types'
import { outdatedProject, type OutdatedRunner } from './package-outdated'
import type { RegisteredProject } from './scanner'

let directory: string
const fixture = { alpha: { current: '1.2.9', wanted: '1.3.0', latest: '3.0.0' }, beta: { current: '2.1.0', wanted: '2.1.3', latest: '2.1.3' } }
const output = (report: unknown, exitCode = 0) => ({ stdout: JSON.stringify(report), stderr: '', exitCode })
const runnerFor = (report: unknown, exitCode = 0) => vi.fn<OutdatedRunner>().mockResolvedValue(output(report, exitCode))
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-outdated-test-')) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

async function entry(manager: RepoProject['packageManager'] = 'npm', manifest = { dependencies: { alpha: '^1.2.9' }, devDependencies: { beta: '^2.1.0' } }): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest))
  await writeFile(path.join(directory, { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lock' }[manager]), '{}')
  return { directory, root: directory, project: { id: 'test', name: 'Test', dirName: 'test', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: manager, scannedAt: new Date().toISOString() } }
}

describe('outdated scanning', () => {
  it('uses bounded read-only npm lookups and computes a conservative weighted sum', async () => {
    const runner = runnerFor(fixture, 1)
    const report = await outdatedProject(await entry(), runner)
    expect(report).toMatchObject({ manager: 'npm', score: 20.3, level: 'moderate', findings: [
      { name: 'alpha', current: '1.2.9', latest: '3.0.0', kind: 'dependencies', change: 'major', majorGap: 2, score: 20 },
      { name: 'beta', kind: 'devDependencies', change: 'patch', score: 0.3 },
    ] })
    expect(runner).toHaveBeenCalledWith('npm', ['outdated', '--json', '--long', '--all=false', '--global=false', '--ignore-scripts', '--include=dev', '--include=optional', '--include=peer'], expect.objectContaining({
      cwd: directory, shell: false, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      env: expect.objectContaining({ COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', npm_config_ignore_scripts: 'true' }),
    }))
    const cache = runner.mock.calls[0][2].env!.npm_config_cache!
    expect(cache.startsWith(directory + path.sep)).toBe(false)
    await expect(lstat(path.dirname(cache))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(directory)).toEqual(['package-lock.json', 'package.json'])
  })

  it('accepts clean reports, ignores ahead versions and build-only differences', async () => {
    const project = await entry()
    expect(await outdatedProject(project, runnerFor({}))).toMatchObject({ score: 0, level: 'current', findings: [] })
    expect(await outdatedProject(project, runnerFor({ alpha: { current: '4.0.0', latest: '3.0.0' }, beta: { current: '2.1.0+one', latest: '2.1.0+two' } }, 1))).toMatchObject({ score: 0, findings: [] })
  })

  it('verifies omitted npm dependencies with registry lookups rather than trusting an empty native report', async () => {
    const project = await entry()
    for (const name of ['alpha', 'beta']) {
      await mkdir(path.join(directory, 'node_modules', name), { recursive: true })
      await writeFile(path.join(directory, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
    }
    const runner = vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => args[0] === 'outdated' ? output({}) : output('3.0.0'))
    expect(await outdatedProject(project, runner)).toMatchObject({ score: 40, level: 'moderate' })
    expect(runner).toHaveBeenCalledTimes(3)
    expect(runner.mock.calls[0][1]).not.toContain('--workspaces=false')
    expect(runner.mock.calls[0][1]).not.toContain('alpha')
    expect(runner).toHaveBeenCalledWith('npm', ['view', 'alpha@latest', 'version', '--json', '--ignore-scripts', '--global=false'], expect.any(Object))
    runner.mockImplementation(async (_command, args) => args[0] === 'outdated' ? output({}) : output({ error: { code: 'E404' } }, 1))
    await expect(outdatedProject(project, runner)).rejects.toThrow('complete, supported outdated report')
  })

  it('compares locked npm versions after node_modules cleanup and excludes workspace findings', async () => {
    const project = await entry()
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/alpha': { version: '1.0.0' }, 'node_modules/beta': { version: '2.0.0' } } }))
    const runner = vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => args[0] === 'outdated'
      ? output({ alpha: { current: '0.1.0', latest: '3.0.0', dependedByLocation: 'packages/child' }, beta: { wanted: '2.0.0', latest: '3.0.0', dependedByLocation: '' } }, 1)
      : output('3.0.0'))
    const report = await outdatedProject(project, runner)
    expect(report.score).toBe(30)
    expect(report.findings.map(finding => [finding.name, finding.current])).toEqual([['alpha', '1.0.0'], ['beta', '2.0.0']])
    expect(report.skipped).toBeUndefined()
  })

  it('uses npm shrinkwrap before package-lock and supports v1 resolved versions', async () => {
    const project = await entry()
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/alpha': { version: '1.0.0' } } }))
    await writeFile(path.join(directory, 'npm-shrinkwrap.json'), JSON.stringify({ lockfileVersion: 1, dependencies: { alpha: { version: '2.0.0' }, beta: { version: '2.0.0' } } }))
    const runner = vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => args[0] === 'outdated' ? output({}) : output('3.0.0'))
    expect((await outdatedProject(project, runner)).score).toBe(20)
  })

  it('bounds the entire scan across fallback queries', async () => {
    const project = await entry()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const runner = vi.fn<OutdatedRunner>().mockImplementation(async () => {
      now.mockReturnValue(122_000)
      return output({})
    })
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/alpha': { version: '1.0.0' }, 'node_modules/beta': { version: '1.0.0' } } }))
    try {
      await expect(outdatedProject(project, runner)).rejects.toThrow('timed out before every dependency')
      expect(runner).toHaveBeenCalledTimes(1)
    } finally { now.mockRestore() }
  })

  it('keeps missing and non-semver versions visible as skipped instead of claiming clean coverage', async () => {
    const report = await outdatedProject(await entry(), runnerFor({ alpha: { latest: '3.0.0' }, beta: { current: 'git', latest: 'linked' } }, 1))
    expect(report.findings).toEqual([])
    expect(report.skipped).toEqual([expect.objectContaining({ name: 'alpha' }), expect.objectContaining({ name: 'beta' })])
  })

  it('reads fresh manifest entries, excludes nonregistry and peer-only requirements, and does not invoke commands when nothing can be compared', async () => {
    const project = await entry()
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { local: 'file:../local', workspace: 'workspace:*', alias: 'npm:alpha@1' }, peerDependencies: { peer: '^2' } }))
    const runner = runnerFor({})
    expect((await outdatedProject(project, runner)).skipped).toHaveLength(4)
    expect(runner).not.toHaveBeenCalled()
  })

  it('supports pnpm JSON and clears inherited dependency selectors', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NPM_CONFIG_PRODUCTION', 'true')
    vi.stubEnv('PNPM_CONFIG_ONLY', 'prod')
    const runner = runnerFor(fixture, 1)
    expect((await outdatedProject(await entry('pnpm'), runner)).score).toBe(20.3)
    expect(runner.mock.calls[0][1]).toEqual(['outdated', '--format=json', '--recursive=false', '--global=false', '--compatible=false', '--optional', 'beta', 'alpha'])
    expect(runner.mock.calls[0][2].env).toMatchObject({ NODE_ENV: 'development', npm_config_production: 'null', pnpm_config_dev: 'null', PNPM_CONFIG_IGNORE_PNPMFILE: 'true' })
    expect(runner.mock.calls[0][2].env!.NPM_CONFIG_PRODUCTION).toBeUndefined()
  })

  it('handles Yarn Classic NDJSON tables and finished-only clean reports', async () => {
    const project = await entry('yarn')
    const runner = vi.fn<OutdatedRunner>().mockResolvedValueOnce({ stdout: '1.22.22', stderr: '', exitCode: 0 }).mockResolvedValueOnce({ stdout: [
      { type: 'info', data: 'Color legend' }, { type: 'table', data: { head: ['Package', 'Current', 'Wanted', 'Latest', 'Package Type', 'URL'], body: [['alpha', '1.2.9', '1.3.0', '3.0.0', 'dependencies', 'https://example.test']] } },
    ].map(value => JSON.stringify(value)).join('\n'), stderr: '', exitCode: 1 })
    expect((await outdatedProject(project, runner)).score).toBe(20)
    expect(runner.mock.calls[1][1][0]).toBe('outdated')
    runner.mockResolvedValueOnce({ stdout: '1.22.22', stderr: '', exitCode: 0 }).mockResolvedValueOnce(output({ type: 'finished', data: 10 }))
    expect((await outdatedProject(project, runner)).findings).toEqual([])
  })

  it('supports modern Yarn using complete resolved-version and registry info reports', async () => {
    const runner = vi.fn<OutdatedRunner>().mockResolvedValueOnce({ stdout: '4.12.0', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: [
        { value: 'alpha@npm:1.2.9', children: { Version: '1.2.9' } }, { value: 'beta@npm:2.1.0', children: { Version: '2.1.0' } },
      ].map(value => JSON.stringify(value)).join('\n'), stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: [{ name: 'alpha', version: '3.0.0' }, { name: 'beta', version: '2.1.3' }].map(value => JSON.stringify(value)).join('\n'), stderr: '', exitCode: 0 })
    expect((await outdatedProject(await entry('yarn'), runner)).score).toBe(20.3)
    expect(runner.mock.calls[1][1]).toEqual(['info', '--json', 'beta', 'alpha'])
    expect(runner.mock.calls[2][1]).toEqual(['npm', 'info', '--json', '--fields', 'name,version', 'beta@latest', 'alpha@latest'])
    const state = runner.mock.calls[1][2].env!.YARN_INSTALL_STATE_PATH!
    expect(state.startsWith(directory + path.sep)).toBe(false)
    await expect(lstat(path.dirname(state))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('excludes Classic Yarn child-workspace updates from the current project score', async () => {
    const runner = vi.fn<OutdatedRunner>().mockResolvedValueOnce({ stdout: '1.22.22', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce(output({ type: 'table', data: { head: ['Package', 'Current', 'Wanted', 'Latest', 'Workspace', 'Package Type', 'URL'], body: [['alpha', '1.0.0', '1.0.0', '9.0.0', 'child-project', 'dependencies', 'https://example.test']] } }, 1))
    expect(await outdatedProject(await entry('yarn'), runner)).toMatchObject({ score: 0, findings: [] })
  })

  it('rejects partial modern Yarn registry reports', async () => {
    const runner = vi.fn<OutdatedRunner>().mockResolvedValueOnce({ stdout: '4.12.0', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: [
        { value: 'alpha@npm:1.2.9', children: { Version: '1.2.9' } }, { value: 'beta@npm:2.1.0', children: { Version: '2.1.0' } },
      ].map(value => JSON.stringify(value)).join('\n'), stderr: '', exitCode: 0 })
      .mockResolvedValueOnce(output({ name: 'alpha', version: '3.0.0' }))
    await expect(outdatedProject(await entry('yarn'), runner)).rejects.toThrow('complete, supported outdated report')
  })

  it('parses Bun ASCII tables and a clean banner with a built-in version guard', async () => {
    const project = await entry('bun')
    const runner = vi.fn<OutdatedRunner>().mockResolvedValueOnce({ stdout: '1.4.2', stderr: '', exitCode: 0 }).mockResolvedValueOnce({ stdout: [
      '| Package | Current | Update | Latest |', '| ------- | ------- | ------ | ------ |', '| alpha | 1.2.9 | 1.3.0 | 3.0.0 |', '| beta (dev) | 2.1.0 | 2.1.3 | 2.1.3 |',
    ].join('\n'), stderr: 'bun outdated v1.4.2', exitCode: 0 })
    expect((await outdatedProject(project, runner)).score).toBe(20.3)
    expect(runner.mock.calls[1][1]).toEqual(['outdated', '--no-save', '--ignore-scripts', '--no-progress', '--cache-dir', expect.any(String), 'beta', 'alpha'])
    runner.mockResolvedValueOnce({ stdout: '1.4.2', stderr: '', exitCode: 0 }).mockResolvedValueOnce({ stdout: '', stderr: 'bun outdated v1.4.2', exitCode: 0 })
    expect((await outdatedProject(project, runner)).findings).toEqual([])
  })

  it('never invokes unsupported Bun commands that could fall back to project scripts', async () => {
    const runner = vi.fn<OutdatedRunner>().mockResolvedValue({ stdout: '1.1.40', stderr: '', exitCode: 0 })
    await expect(outdatedProject(await entry('bun'), runner)).rejects.toThrow('Bun 1.2.0')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0][1]).toEqual(['--version'])
  })

  it('never invokes info as a project script on older modern Yarn versions', async () => {
    const runner = vi.fn<OutdatedRunner>().mockResolvedValue({ stdout: '2.2.2', stderr: '', exitCode: 0 })
    await expect(outdatedProject(await entry('yarn'), runner)).rejects.toThrow('Yarn 2.3')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0][1]).toEqual(['--version'])
  })

  it.each([
    ['empty', '', '', 0], ['malformed', '{broken', '', 0], ['unexpected shape', '[]', '', 0],
    ['error', '{"error":{"code":"E503"}}', '', 1], ['partial entry', '{"alpha":{"current":"1.0.0"}}', '', 0],
    ['wrong entry type', '{"alpha":{"current":42,"latest":"2.0.0"}}', '', 1],
    ['nonzero empty', '{}', '', 1], ['unexpected exit', JSON.stringify(fixture), '', 127],
    ['partial registry failure', '{}', 'Skipped alpha: registry failed', 0],
  ])('rejects %s reports', async (_name, stdout, stderr, exitCode) => {
    await expect(outdatedProject(await entry(), vi.fn<OutdatedRunner>().mockResolvedValue({ stdout, stderr, exitCode }))).rejects.toThrow('complete, supported outdated report')
  })

  it('deduplicates findings and restricts the sum to direct packages in the current manifest', async () => {
    const report = await outdatedProject(await entry(), runnerFor({ alpha: [fixture.alpha, fixture.alpha], transitive: { current: '1.0.0', latest: '99.0.0' } }, 1))
    expect(report.findings).toHaveLength(1)
    expect(report.score).toBe(20)
  })

  it('requires regular lockfiles and metadata before starting any process', async () => {
    const project = await entry()
    const runner = runnerFor({})
    await symlink(path.join(directory, 'package-lock.json'), path.join(directory, 'npm-shrinkwrap.json'))
    await expect(outdatedProject(project, runner)).rejects.toThrow('regular npm-shrinkwrap.json')
    await rm(path.join(directory, 'package.json'))
    await expect(outdatedProject(project, runner)).rejects.toThrow('regular, valid package.json')
    expect(runner).not.toHaveBeenCalled()
  })

  it('maps process failures to actionable errors', async () => {
    const project = await entry()
    const runner = vi.fn<OutdatedRunner>().mockRejectedValue({ killed: true })
    await expect(outdatedProject(project, runner)).rejects.toThrow('timed out or was interrupted')
    runner.mockRejectedValue({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
    await expect(outdatedProject(project, runner)).rejects.toThrow('8 MB output limit')
    runner.mockRejectedValue({ code: 'ENOENT' })
    await expect(outdatedProject(project, runner)).rejects.toThrow('npm is not installed')
  })
})
