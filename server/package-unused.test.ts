import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unusedProject, type KnipRunner } from './package-unused'
import type { RegisteredProject } from './scanner'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-knip-test-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const row = (file = 'package.json') => ({ file, dependencies: [{ name: 'unused', line: 5 }], devDependencies: [{ name: 'dev-unused', line: 8 }], optionalPeerDependencies: [{ name: 'used-peer' }] })
const runnerFor = (report: unknown, exitCode = 0, stderr = '') => vi.fn<KnipRunner>().mockResolvedValue({ stdout: JSON.stringify(report), stderr, exitCode })

async function entry(): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { unused: '^1.0.0', shared: '^1.0.0' }, devDependencies: { 'dev-unused': '~2.0.0' }, peerDependencies: { 'used-peer': '*' } }))
  return { directory, root: directory, project: { id: 'test', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: new Date().toISOString() } }
}

describe('Knip reports', () => {
  it('keeps source analysis visible while Knip runs and validates findings only after success', async () => {
    const project = await entry()
    const progress = vi.fn()
    const runner = vi.fn<KnipRunner>().mockImplementation(async () => {
      expect(progress.mock.lastCall?.[0].phase).toBe('Analyzing imports and dependency usage')
      return { stdout: JSON.stringify({ issues: [] }), stderr: '', exitCode: 0 }
    })
    await unusedProject(project, runner, progress)
    expect(progress.mock.lastCall?.[0].phase).toBe('Validating and matching unused dependencies')
    progress.mockClear()
    runner.mockRejectedValue({ killed: true })
    await expect(unusedProject(project, runner, progress)).rejects.toThrow('two-minute')
    expect(progress.mock.lastCall?.[0].phase).toBe('Analyzing imports and dependency usage')
  })

  it('runs the bundled CLI with bounds and reports fresh declarations, not referenced optional peers', async () => {
    const project = await entry()
    const runner = runnerFor({ issues: [row()] })
    const report = await unusedProject(project, runner)
    expect(report).toMatchObject({ knipVersion: '6.40.0', findings: [
      { name: 'unused', version: '^1.0.0', kind: 'dependencies', line: 5 },
      { name: 'dev-unused', version: '~2.0.0', kind: 'devDependencies', line: 8 },
    ] })
    expect(Number.isNaN(Date.parse(report.scannedAt))).toBe(false)
    expect(runner).toHaveBeenCalledWith(process.execPath, [expect.stringContaining('/knip/bin/knip.js'), '--include', 'dependencies', '--reporter', 'json', '--no-progress', '--no-config-hints', '--no-exit-code'], expect.objectContaining({ cwd: directory, shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }))
    expect(await readdir(directory)).toEqual(['package.json'])
  })

  it('accepts no findings and retains bounded, plain-text diagnostics', async () => {
    const report = await unusedProject(await entry(), runnerFor({ issues: [] }, 0, '\u001b[33mCheck custom entry points\u001b[0m'))
    expect(report.findings).toEqual([])
    expect(report.warning).toBe('Check custom entry points')
  })

  it('filters sibling findings even when package names overlap', async () => {
    const project = await entry()
    const member = path.join(directory, 'packages/member')
    await mkdir(member, { recursive: true })
    await writeFile(path.join(member, 'package.json'), await readFile(path.join(directory, 'package.json')))
    const runner = runnerFor({ issues: [row(), { ...row('packages/member/package.json'), dependencies: [] }, row('packages/sibling/package.json')] })
    expect((await unusedProject({ ...project, directory: member, workspaceDirectory: directory }, runner)).findings.map(item => item.name)).toEqual(['dev-unused'])
    expect(runner.mock.calls[0][2].cwd).toBe(directory)
    expect((await unusedProject(project, runner)).findings).toHaveLength(2)
  })

  it.each([{}, { issues: null }, { issues: [{}] }, { issues: [{ file: 'package.json' }] }, { issues: [{ ...row(), dependencies: ['unused'] }] }, { issues: [{ ...row(), dependencies: [{ name: 'unknown' }] }] }, { issues: [{ ...row(), dependencies: [{ name: 'unused', line: -1 }] }] }])('rejects incomplete or inconsistent output: %j', async report => {
    await expect(unusedProject(await entry(), runnerFor(report))).rejects.toMatchObject({ status: 502 })
  })

  it('rejects partial JSON on config failure and releases useful diagnostics', async () => {
    await expect(unusedProject(await entry(), runnerFor({ issues: [] }, 2, 'Unable to load vite.config.ts'))).rejects.toThrow('Unable to load vite.config.ts')
    await expect(unusedProject(await entry(), vi.fn<KnipRunner>().mockResolvedValue({ stdout: 'not JSON', stderr: '', exitCode: 0 }))).rejects.toThrow('complete, supported')
  })

  it('rejects linked or invalid manifests before starting Knip', async () => {
    const project = await entry()
    const runner = runnerFor({ issues: [] })
    await writeFile(path.join(directory, 'package.json'), 'null')
    await expect(unusedProject(project, runner)).rejects.toThrow('valid package.json')
    await rm(path.join(directory, 'package.json'))
    await writeFile(path.join(directory, 'linked.json'), '{}')
    await symlink(path.join(directory, 'linked.json'), path.join(directory, 'package.json'))
    await expect(unusedProject(project, runner)).rejects.toThrow('regular, valid package.json')
    expect(runner).not.toHaveBeenCalled()
  })

  it('distinguishes timeouts, oversized output, and launch errors from clean scans', async () => {
    const project = await entry()
    for (const [error, message] of [[{ killed: true }, 'two-minute'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '8 MB'], [{ code: 'ENOENT' }, 'Could not start Knip']] as const) {
      const runner = vi.fn<KnipRunner>().mockRejectedValue(error)
      await expect(unusedProject(project, runner)).rejects.toThrow(message)
    }
  })
})

async function snapshot(dir: string, relative = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const item of await readdir(path.join(dir, relative), { withFileTypes: true })) {
    const filename = path.join(relative, item.name)
    if (item.isDirectory()) Object.assign(files, await snapshot(dir, filename))
    else files[filename] = await readFile(path.join(dir, filename), 'utf8')
  }
  return files
}

it('scans real source and workspace usage, honors Knip config, and leaves files unchanged', async () => {
  const project = await entry()
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'], dependencies: { unused: '^1.0.0', shared: '^1.0.0' } }))
  const member = path.join(directory, 'packages/member')
  await mkdir(member, { recursive: true })
  await writeFile(path.join(member, 'package.json'), JSON.stringify({ name: 'member', dependencies: { used: '^1.0.0', unused: '^1.0.0' }, devDependencies: { 'dev-unused': '~2.0.0' } }))
  await writeFile(path.join(member, 'index.js'), "import 'used'; import 'shared';\n")
  await writeFile(path.join(directory, 'knip.json'), JSON.stringify({ workspaces: { '.': { entry: 'index.js' }, 'packages/*': { entry: 'index.js' } } }))
  for (const name of ['used', 'unused', 'shared', 'dev-unused']) {
    const installed = path.join(directory, 'node_modules', name)
    await mkdir(installed, { recursive: true })
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
    await writeFile(path.join(installed, 'index.js'), 'module.exports = {}\n')
  }
  const original = await snapshot(directory)
  expect((await unusedProject(project)).findings.map(item => item.name)).toEqual(['unused'])
  const memberEntry = { ...project, directory: member, workspaceDirectory: directory }
  expect((await unusedProject(memberEntry)).findings.map(item => item.name)).toEqual(['unused', 'dev-unused'])
  expect(await snapshot(directory)).toEqual(original)
  await writeFile(path.join(directory, 'knip.json'), JSON.stringify({ rules: { devDependencies: 'off' } }))
  expect((await unusedProject(memberEntry)).findings.map(item => item.name)).toEqual(['unused'])
  await writeFile(path.join(directory, 'knip.json'), JSON.stringify({ ignoreDependencies: ['unused', 'dev-unused'] }))
  expect((await unusedProject(memberEntry)).findings).toEqual([])
  await writeFile(path.join(directory, 'knip.json'), '{ invalid config')
  await expect(unusedProject(project)).rejects.toMatchObject({ status: 502 })
  expect((await lstat(path.join(member, 'package.json'))).isFile()).toBe(true)
}, 30_000)
