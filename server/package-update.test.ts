import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { updateProject, updateTarget } from './package-update'
import type { OutdatedRunner } from './package-outdated'
import type { RegisteredProject } from './scanner'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-update-test-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const output = (data: unknown) => ({ stdout: JSON.stringify(data), stderr: '', exitCode: 0 })
async function fixture(): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.2.0' }, devDependencies: { beta: '~1.2.0' } }))
  await writeFile(path.join(directory, 'package-lock.json'), '{}')
  return { directory, root: directory, project: { id: 'fixture', name: 'fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' } }
}
function runner() {
  return vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => {
    if (args[0] === 'outdated') return output({ alpha: { current: '1.2.0', latest: '3.0.0' }, beta: { current: '1.2.1', latest: '3.0.0' } })
    if (args[0] === 'view') return output(['3.0.0', '1.3.2', '1.2.4', '1.2.3', '1.4.0-beta.1'])
    return output({})
  })
}

it('chooses the highest stable compatible version without downgrades or major upgrades', () => {
  const versions = ['1.2.9', '1.2.10', '1.3.0', '2.0.0', '1.4.0-beta.1']
  expect(updateTarget('1.2.3', versions, 'patch')).toBe('1.2.10')
  expect(updateTarget('1.2.3', versions, 'minor')).toBe('1.3.0')
  expect(updateTarget('1.5.0', versions, 'minor')).toBeUndefined()
  expect(updateTarget('1.2.0-beta.1', versions, 'minor')).toBeUndefined()
  expect(updateTarget('0.2.0', ['0.2.1', '0.3.0', '1.0.0'], 'patch')).toBe('0.2.1')
})

it.each(['patch', 'minor'] as const)('updates %s releases on an older major and preserves dependency groups', async level => {
  const entry = await fixture(), run = runner()
  const result = await updateProject(entry, level, run)
  const target = level === 'patch' ? '1.2.4' : '1.3.2'
  expect(result.packages).toEqual([{ name: 'alpha', from: '1.2.0', to: target, kind: 'dependencies' }, { name: 'beta', from: '1.2.1', to: target, kind: 'devDependencies' }])
  const installs = run.mock.calls.filter(([, args]) => args[0] === 'install')
  expect(installs).toHaveLength(2)
  expect(installs[0][1]).toEqual(expect.arrayContaining(['--save-prod', '--save-exact', '--ignore-scripts', `alpha@${target}`]))
  expect(installs[1][1]).toContain('--save-dev')
  expect(installs[0][2]).toMatchObject({ cwd: directory, shell: false, env: { npm_config_ignore_scripts: 'true' } })
})

it('does not install anything if a registry lookup fails', async () => {
  const entry = await fixture(), run = runner()
  run.mockImplementation(async (_command, args) => args[0] === 'outdated' ? output({ alpha: { current: '1.2.0', latest: '3.0.0' }, beta: { current: '1.2.1', latest: '3.0.0' } }) : { stdout: '', stderr: 'registry unavailable', exitCode: 1 })
  await expect(updateProject(entry, 'patch', run)).rejects.toThrow('registry connection')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})

it.each([
  ['invalid JSON', '{'],
  ['non-object manifest', 'null'],
  ['invalid dependency section', '{"dependencies":[]}'],
  ['invalid dependency version', '{"dependencies":{"alpha":false}}'],
])('rejects %s before invoking package commands', async (_label, manifest) => {
  const entry = await fixture(), run = runner()
  await writeFile(path.join(directory, 'package.json'), manifest)
  await expect(updateProject(entry, 'patch', run)).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
  expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(manifest)
})

it('does not overwrite a manifest changed during lookup', async () => {
  const entry = await fixture(), run = runner()
  const implementation = run.getMockImplementation()!
  run.mockImplementation(async (...args) => {
    if (args[1][0] === 'view') await writeFile(path.join(directory, 'package.json'), '{"name":"edited"}')
    return implementation(...args)
  })
  await expect(updateProject(entry, 'minor', run)).rejects.toThrow('changed during')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
  expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe('{"name":"edited"}')
})

it('skips ambiguous and complex dependency declarations', async () => {
  const entry = await fixture(), run = runner()
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { alpha: '^1.0.0 || ^2.0.0', beta: '^1.2.0' }, peerDependencies: { beta: '^1.2.0' } }))
  const result = await updateProject(entry, 'minor', run)
  expect(result.packages).toEqual([])
  expect(result.skipped).toHaveLength(2)
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})

it.each(['pnpm', 'yarn-classic', 'yarn-modern', 'bun'] as const)('uses the %s registry and install command with scripts disabled', async variant => {
  const entry = await fixture()
  const manager = variant.startsWith('yarn') ? 'yarn' : variant as 'pnpm' | 'bun'
  entry.project.packageManager = manager
  await writeFile(path.join(directory, manager === 'pnpm' ? 'pnpm-lock.yaml' : manager === 'yarn' ? 'yarn.lock' : 'bun.lock'), '')
  await writeFile(path.join(directory, 'package.json'), '{"dependencies":{"alpha":"^1.2.0"}}')
  const run = vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => {
    if (args[0] === '--version') return { stdout: variant === 'yarn-classic' ? '1.22.22' : manager === 'bun' ? '1.4.2' : '4.0.0', stderr: '', exitCode: 0 }
    if (args[0] === 'outdated') {
      if (variant === 'yarn-classic') return output({ type: 'table', data: { head: ['Package', 'Current', 'Wanted', 'Latest', 'Package Type', 'URL'], body: [['alpha', '1.2.0', '1.3.0', '2.0.0', 'dependencies', 'https://example.test']] } })
      if (manager === 'bun') return { stdout: '| Package | Current | Update | Latest |\n| alpha | 1.2.0 | 1.3.0 | 2.0.0 |', stderr: 'bun outdated v1.4.2', exitCode: 0 }
      return output({ alpha: { current: '1.2.0', latest: '2.0.0' } })
    }
    if (variant === 'yarn-modern' && args[0] === 'info') return output({ value: 'alpha@npm:1.2.0', children: { Version: '1.2.0' } })
    if (variant === 'yarn-modern' && args.includes('name,version')) return output({ name: 'alpha', version: '2.0.0' })
    if (args[0] === 'add') return output({})
    const versions = ['1.2.0', '1.2.4', '1.3.0', '2.0.0']
    return output(variant === 'yarn-classic' ? { type: 'inspect', data: versions } : variant === 'yarn-modern' ? { versions } : versions)
  })
  expect((await updateProject(entry, 'patch', run)).packages[0].to).toBe('1.2.4')
  const install = run.mock.calls.find(([, args]) => args[0] === 'add')!
  expect(install[0]).toBe(manager)
  expect(install[1]).toContain('alpha@1.2.4')
  expect(install[1]).toContain(variant === 'yarn-modern' ? '--mode=skip-build' : '--ignore-scripts')
  expect(install[1]).toContain(manager === 'pnpm' ? '--save-exact' : '--exact')
})
