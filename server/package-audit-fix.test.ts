import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuditFinding } from '../src/types'
import { fixAuditFinding, validateAuditFixRequest, prepareAuditFix } from './package-audit-fix'
import type { AuditRunner } from './package-audit'
import type { OutdatedRunner } from './package-outdated'
import type { RegisteredProject } from './scanner'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-audit-fix-'))) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const request = { name: 'alpha', title: 'Unsafe input', range: '<1.5.0', url: 'https://example.com/advisory' }
const output = (data: unknown) => ({ stdout: JSON.stringify(data), stderr: '', exitCode: 0 })

async function fixture(): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.2.0', beta: '^3.0.0' } }))
  await writeFile(path.join(directory, 'package-lock.json'), '{}')
  return { directory, root: directory, project: { id: 'fixture', name: 'fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' } }
}
function auditRun(options: { fix?: unknown; range?: string; direct?: boolean; title?: string } = {}) {
  const parent = typeof options.fix === 'object' && options.fix !== null
  return vi.fn<AuditRunner>().mockResolvedValue({ ...output({ vulnerabilities: {
    alpha: { name: 'alpha', severity: 'high', isDirect: options.direct ?? true, range: options.range ?? request.range,
      fixAvailable: options.fix ?? true, via: [{ name: 'alpha', severity: 'high', title: options.title ?? request.title, url: request.url, range: options.range ?? request.range }] },
    ...(parent ? { beta: { name: 'beta', severity: 'high', isDirect: true, range: '<3.0.2', fixAvailable: options.fix, via: ['alpha'] } } : {}),
  }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: parent ? 2 : 1, critical: 0 } } }), exitCode: 1 })
}
function updateRun(versions = ['1.2.4', '1.5.0', '1.8.0', '2.0.0']) {
  return vi.fn<OutdatedRunner>().mockImplementation(async (_command, args) => {
    if (args[0] === 'outdated') return output({ alpha: { current: '1.2.0', latest: '2.0.0' }, beta: { current: '3.0.0', latest: '4.0.0' } })
    if (args[0] === 'view') return output(versions)
    return output({})
  })
}

it('rechecks a finding and installs only its compatible fixed dependency with lifecycle scripts disabled', async () => {
  const entry = await fixture(), run = updateRun(), audit = auditRun()
  const result = await fixAuditFinding(entry, request, run, audit)
  expect(audit).toHaveBeenCalledOnce()
  expect(result.packages).toEqual([{ name: 'alpha', from: '1.2.0', to: '1.8.0', kind: 'dependencies' }])
  const installs = run.mock.calls.filter(([, args]) => args[0] === 'install')
  expect(installs).toHaveLength(1)
  expect(installs[0][1]).toEqual(['install', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', '--global=false', '--save-prod', 'alpha@1.8.0'])
  expect(installs[0][2]).toMatchObject({ cwd: directory, shell: false, env: { npm_config_ignore_scripts: 'true' } })
  expect(run.mock.calls.filter(([, args]) => args[0] === 'view').map(([, args]) => args[1])).toEqual(['alpha'])
})

it.each([
  ['only a major upgrade fixes it', '<2.0.0', ['1.9.0', '2.0.0']],
  ['all compatible releases remain affected', '<1.5.0', ['1.2.4', '1.4.0']],
  ['only a prerelease fixes it', '<1.5.0', ['1.2.4', '1.5.0-beta.1']],
])('does not install when %s', async (_title, range, versions) => {
  const entry = await fixture(), run = updateRun(versions)
  await expect(fixAuditFinding(entry, { ...request, range }, run, auditRun({ range }))).rejects.toThrow('No compatible minor or patch fix')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})

it.each([{ fix: false }, { title: 'Changed advisory' }, { direct: false }])('does not install stale, unfixable or unmapped transitive findings: %j', async options => {
  const entry = await fixture(), run = updateRun()
  await expect(fixAuditFinding(entry, request, run, auditRun(options))).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})

it('updates an explicitly identified direct parent without adding the vulnerable transitive package', async () => {
  const entry = await fixture(), run = updateRun(['3.0.2', '3.1.0', '4.0.0'])
  const audit = auditRun({ direct: false, fix: { name: 'beta', version: '3.0.2', isSemVerMajor: false } })
  const result = await fixAuditFinding(entry, request, run, audit)
  expect(result.packages).toEqual([{ name: 'beta', from: '3.0.0', to: '3.0.2', kind: 'dependencies' }])
  expect(run.mock.calls.filter(([, args]) => args[0] === 'install')[0][1]).toContain('beta@3.0.2')
})

it('rejects an explicit parent remediation that crosses the installed major version', async () => {
  const entry = await fixture(), run = updateRun(['3.0.2', '4.0.0'])
  await expect(fixAuditFinding(entry, request, run, auditRun({ direct: false, fix: { name: 'beta', version: '4.0.0', isSemVerMajor: true } }))).rejects.toThrow('No compatible minor or patch fix')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})

it('honors all affected and patched ranges for a package, not just the clicked advisory', async () => {
  const entry = await fixture(), run = updateRun(['1.5.0', '1.6.0', '1.8.0', '1.9.0', '2.0.0'])
  const advisory = { module_name: 'alpha', severity: 'high', title: request.title, url: request.url, vulnerable_versions: request.range, patched_versions: '>=1.6.0' }
  const audit = vi.fn<AuditRunner>().mockResolvedValue({ ...output({ advisories: {
    one: advisory, two: { ...advisory, title: 'Another issue', vulnerable_versions: '>=1.9.0 <2.0.0', patched_versions: '<1.9.0 || >=2.0.0' },
  }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } } }), exitCode: 1 })
  const result = await fixAuditFinding(entry, request, run, audit)
  expect(result.packages[0].to).toBe('1.8.0')
})

it('rechecks project inputs before installing so changed lockfiles cannot use an old audit', async () => {
  const entry = await fixture(), run = updateRun()
  const implementation = run.getMockImplementation()!
  run.mockImplementation(async (...args) => {
    if (args[1][0] === 'view') await writeFile(path.join(directory, 'package-lock.json'), '{"changed":true}')
    return implementation(...args)
  })
  await expect(fixAuditFinding(entry, request, run, auditRun())).rejects.toThrow('Package files or ignore rules changed')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})

it('never installs duplicate or peer-only declarations', async () => {
  const entry = await fixture(), run = updateRun()
  const original = JSON.stringify({ dependencies: { alpha: '^1.2.0' }, peerDependencies: { alpha: '^1.2.0' } })
  await writeFile(path.join(directory, 'package.json'), original)
  await expect(fixAuditFinding(entry, request, run, auditRun())).rejects.toThrow()
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
  expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(original)
})

it.each([null, [], {}, { ...request, name: '--prefix=/tmp/elsewhere' }, { ...request, title: '' }, { ...request, range: 3 }])('validates request identity before using it: %j', value => {
  expect(() => validateAuditFixRequest(value)).toThrow()
})

it('does not accept a browser-supplied install target', () => {
  expect(validateAuditFixRequest({ ...request, fixTarget: { name: 'unrelated', version: '9.0.0' } } as AuditFinding)).toEqual(request)
})


it('does not change a workspace member whose installed dependency is outside the clicked vulnerable range', async () => {
  const entry = await fixture(), run = updateRun()
  const implementation = run.getMockImplementation()!
  run.mockImplementation(async (...args) => args[1][0] === 'outdated'
    ? output({ alpha: { current: '1.5.0', latest: '2.0.0' }, beta: { current: '3.0.0', latest: '4.0.0' } })
    : implementation(...args))
  await expect(fixAuditFinding(entry, request, run, auditRun())).rejects.toThrow('not affected by this finding')
  expect(run.mock.calls.some(([, args]) => args[0] === 'install' || args[0] === 'view')).toBe(false)
})

it('prepares a freshly audited exact fix without invoking an install', async () => {
  const entry = await fixture(), run = updateRun(), audit = auditRun()
  const plan = await prepareAuditFix(entry, request, run, audit)
  expect(audit).toHaveBeenCalledOnce()
  expect(plan.targets).toEqual([{ name: 'alpha', from: '1.2.0', to: '1.8.0', kind: 'dependencies' }])
  expect(run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
})
