import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoProject } from '../src/types'
import { auditProject, type AuditRunner } from './package-audit'
import type { RegisteredProject } from './scanner'

let directory: string
const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
const advisory = {
  module_name: 'vulnerable-package', title: 'A test vulnerability', severity: 'high',
  vulnerable_versions: '<2.0.0', patched_versions: '>=2.0.0', url: 'https://example.test/advisory',
}
const npmReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    'vulnerable-package': { name: 'vulnerable-package', severity: 'high', isDirect: true, via: [advisory], range: '<2.0.0', fixAvailable: { name: 'vulnerable-package', version: '2.0.0' } },
    'parent-package': { name: 'parent-package', severity: 'high', isDirect: false, via: ['vulnerable-package'], range: '*', fixAvailable: false },
  },
  metadata: { vulnerabilities: { ...zero, high: 2, total: 2 } },
}
const cleanReport = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { ...zero, total: 0 } } }
const runnerFor = (report: unknown, exitCode = 0): ReturnType<typeof vi.fn<AuditRunner>> => vi.fn<AuditRunner>().mockImplementation(async (command, args) =>
  command === 'bun' && args[0] === '--version'
    ? { stdout: '1.4.2', stderr: '', exitCode: 0 }
    : { stdout: JSON.stringify(report), stderr: '', exitCode })

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-audit-test-'))
  await writeFile(path.join(directory, 'package.json'), '{"name":"test"}')
})
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) })

async function entry(manager: RepoProject['packageManager'] = 'npm', lockfile?: string): Promise<RegisteredProject> {
  await writeFile(path.join(directory, lockfile ?? { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lock' }[manager]), '{}')
  return {
    directory, root: directory,
    project: { id: 'test', name: 'Test', dirName: 'test', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: manager, scannedAt: new Date().toISOString() },
  }
}

describe('package auditing', () => {
  it('reports registry and suppression stages only after their prerequisites succeed', async () => {
    const project = await entry()
    const progress = vi.fn()
    const runner = vi.fn<AuditRunner>().mockImplementation(async () => {
      expect(progress.mock.lastCall?.[0].phase).toBe('Querying the vulnerability registry')
      return { stdout: JSON.stringify(cleanReport), stderr: '', exitCode: 0 }
    })
    await auditProject(project, runner, progress)
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual([
      'Checking the manifest and lockfile', 'Reading vulnerability ignore rules',
      'Querying the vulnerability registry', 'Validating vulnerability findings',
      'Matching advisory aliases and ignore rules', 'Preparing the vulnerability report',
    ])
    progress.mockClear()
    runner.mockRejectedValue({ killed: true })
    await expect(auditProject(project, runner, progress)).rejects.toThrow('timed out')
    expect(progress.mock.lastCall?.[0].phase).toBe('Querying the vulnerability registry')
  })

  it('matches a CVE-only rule to an npm GHSA URL and leaves failures active with a warning', async () => {
    await writeFile(path.join(directory, '.trivyignore'), 'CVE-2026-12345')
    const project = await entry()
    const report = structuredClone(npmReport)
    report.vulnerabilities['vulnerable-package'].via[0].url = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ghsa_id: 'GHSA-aaaa-bbbb-cccc', cve_id: 'CVE-2026-12345' }))
    vi.stubGlobal('fetch', fetcher)
    expect((await auditProject(project, runnerFor(report, 1))).counts).toEqual(zero)
    fetcher.mockRejectedValue(new Error('offline'))
    const unavailable = await auditProject(project, runnerFor(report, 1))
    expect(unavailable.counts.high).toBe(2)
    expect(unavailable.findings.every(finding => !finding.suppression)).toBe(true)
    expect(unavailable.warnings?.[0]).toContain('Unmatched findings remain active')
  })

  it('suppresses a matching CVE and its inherited npm findings without changing the audit command', async () => {
    const project = await entry()
    await writeFile(path.join(directory, '.trivyignore'), 'CVE-2026-12345 # unreachable in this app')
    const report = structuredClone(npmReport)
    Object.assign(report.vulnerabilities['vulnerable-package'].via[0], { cves: ['CVE-2026-12345'] })
    const result = await auditProject(project, runnerFor(report, 1))
    expect(result.counts).toEqual(zero)
    expect(result.originalCounts).toEqual({ ...zero, high: 2 })
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every(finding => finding.suppression?.ids.includes('CVE-2026-12345'))).toBe(true)
    expect(result.findings.some(finding => 'via' in finding || 'advisories' in finding)).toBe(false)
  })

  it('keeps other advisories on a mixed package active and moves suppressed details last', async () => {
    await writeFile(path.join(directory, '.trivyignore'), 'GHSA-aaaa-bbbb-cccc')
    const result = await auditProject(await entry(), runnerFor({
      vulnerabilities: { parent: { severity: 'critical', via: ['mixed'] }, mixed: { severity: 'critical', via: [
        { ...advisory, module_name: 'mixed', severity: 'critical', title: 'Ignored issue', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' },
        { ...advisory, module_name: 'mixed', severity: 'low', title: 'Active issue' },
      ] } }, metadata: { vulnerabilities: { ...zero, critical: 2 } },
    }, 1))
    expect(result.counts).toEqual({ ...zero, low: 2 })
    expect(result.findings.map(finding => [finding.title, !!finding.suppression])).toEqual([['Active issue', false], ['Depends on a vulnerable package', false], ['Ignored issue', true]])
  })

  it('uses only workspace-root rules for shared audits and only project rules for independent projects', async () => {
    const project = await entry()
    const child = path.join(directory, 'child')
    await mkdir(child)
    await writeFile(path.join(child, 'package.json'), '{}')
    await writeFile(path.join(child, '.trivyignore'), 'CVE-2026-12345')
    const report = { advisories: { 1: { ...advisory, cves: ['CVE-2026-12345'] } }, metadata: { vulnerabilities: { ...zero, high: 1 } } }
    const shared = { ...project, directory: child, workspaceDirectory: directory }
    expect((await auditProject(shared, runnerFor(report, 1))).counts.high).toBe(1)
    await writeFile(path.join(directory, '.trivyignore'), 'CVE-2026-12345')
    expect((await auditProject(shared, runnerFor(report, 1))).counts.high).toBe(0)
    await rm(path.join(child, '.trivyignore'))
    await writeFile(path.join(child, 'package-lock.json'), '{}')
    expect((await auditProject({ ...shared, workspaceDirectory: undefined }, runnerFor(report, 1))).counts.high).toBe(1)
  })

  it('retains summary-only counts and unresolved dependency cycles', async () => {
    await writeFile(path.join(directory, '.trivyignore'), 'CVE-2026-12345')
    const result = await auditProject(await entry(), runnerFor({
      vulnerabilities: {
        ignored: { severity: 'high', via: [{ ...advisory, cves: ['CVE-2026-12345'] }] },
        cycleA: { severity: 'high', via: ['cycleB'] }, cycleB: { severity: 'high', via: ['cycleA'] },
        missing: { severity: 'high', via: ['unknown'] },
      }, metadata: { vulnerabilities: { ...zero, high: 5 } },
    }, 1))
    expect(result.counts.high).toBe(4)
    expect(result.findings.filter(finding => finding.suppression)).toHaveLength(1)
  })

  it('reports the first unsafe lockfile when both npm candidates are linked', async () => {
    const project = await entry()
    await rm(path.join(directory, 'package-lock.json'))
    await symlink(path.join(directory, 'package.json'), path.join(directory, 'package-lock.json'))
    await symlink(path.join(directory, 'package.json'), path.join(directory, 'npm-shrinkwrap.json'))
    const runner = runnerFor(cleanReport)
    await expect(auditProject(project, runner)).rejects.toThrow('regular package-lock.json')
    expect(runner).not.toHaveBeenCalled()
  })

  it('uses a bounded read-only npm command and accepts its nonzero vulnerability exit', async () => {
    const project = await entry()
    const runner = runnerFor(npmReport, 1)
    const report = await auditProject(project, runner)
    expect(report).toMatchObject({ manager: 'npm', counts: { ...zero, high: 2 } })
    expect(report.findings).toContainEqual(expect.objectContaining({ name: 'vulnerable-package', direct: true, severity: 'high', fixAvailable: true, fixTarget: { name: 'vulnerable-package', version: '2.0.0' }, range: '<2.0.0' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ name: 'parent-package', title: 'Depends on a vulnerable package', fixAvailable: false }))
    expect(runner).toHaveBeenCalledWith('npm', ['audit', '--json', '--package-lock-only', '--ignore-scripts', '--include=dev', '--include=optional', '--include=peer'], expect.objectContaining({
      cwd: directory, shell: false, timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      env: expect.objectContaining({ COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', npm_config_ignore_scripts: 'true', NODE_ENV: 'development' }),
    }))
    expect(await readdir(directory)).toEqual(['package-lock.json', 'package.json'])
  })

  it('accepts a verified empty npm report and npm-shrinkwrap', async () => {
    expect(await auditProject(await entry('npm', 'npm-shrinkwrap.json'), runnerFor(cleanReport))).toMatchObject({ counts: zero, findings: [] })
  })

  it('preserves the actual npm parent fix target and its major-version indicator', async () => {
    const fixAvailable = { name: '@scope/direct-parent', version: '3.1.0', isSemVerMajor: true }
    const report = { ...npmReport, vulnerabilities: { ...npmReport.vulnerabilities, 'vulnerable-package': { ...npmReport.vulnerabilities['vulnerable-package'], isDirect: false, fixAvailable } } }
    const result = await auditProject(await entry(), runnerFor(report, 1))
    expect(result.findings.find(finding => finding.name === 'vulnerable-package')).toMatchObject({ direct: false, fixAvailable: true, fixTarget: fixAvailable })
  })

  it.each([
    {}, { name: '--global', version: '1.2.3' }, { name: 'package', version: 'latest' },
    { name: 'package', version: '^1.2.3' }, { name: 'package', version: '1.2.3', isSemVerMajor: 'false' },
  ])('does not advertise malformed npm remediation metadata (%j)', async fixAvailable => {
    const report = { ...npmReport, vulnerabilities: { ...npmReport.vulnerabilities, 'vulnerable-package': { ...npmReport.vulnerabilities['vulnerable-package'], fixAvailable } } }
    const result = await auditProject(await entry(), runnerFor(report, 1))
    const finding = result.findings.find(finding => finding.name === 'vulnerable-package')
    expect(finding?.fixAvailable).toBeUndefined()
    expect(finding?.fixTarget).toBeUndefined()
  })

  it('preserves advisory patched ranges and leaves absent fix details unknown', async () => {
    const report = { advisories: { 123: advisory, 456: { ...advisory, module_name: 'unknown-fix', patched_versions: undefined } }, metadata: { vulnerabilities: { ...zero, high: 2 } } }
    const result = await auditProject(await entry('pnpm'), runnerFor(report, 1))
    expect(result.findings.find(finding => finding.name === 'vulnerable-package')).toMatchObject({ fixAvailable: true, patchedRange: '>=2.0.0' })
    const unknown = result.findings.find(finding => finding.name === 'unknown-fix')
    expect(unknown?.fixAvailable).toBeUndefined()
    expect(unknown?.patchedRange).toBeUndefined()
    expect(unknown?.fixTarget).toBeUndefined()
  })

  it('parses legacy pnpm advisory reports including unfixable findings', async () => {
    const runner = runnerFor({ advisories: { '123': { ...advisory, patched_versions: null } }, metadata: { vulnerabilities: { ...zero, high: 1 } } }, 1)
    const report = await auditProject(await entry('pnpm'), runner)
    expect(report.findings[0]).toMatchObject({ name: 'vulnerable-package', fixAvailable: false })
    expect(runner).toHaveBeenCalledWith('pnpm', ['audit', '--json', '--audit-level=info', '--optional'], expect.any(Object))
  })

  it('audits all pnpm dependency groups even when the helper inherits production-only settings', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NPM_CONFIG_PRODUCTION', 'true')
    vi.stubEnv('PNPM_CONFIG_ONLY', 'prod')
    vi.stubEnv('pnpm_config_dev', 'true')
    const runner = runnerFor({ advisories: {}, metadata: { vulnerabilities: zero } })
    await auditProject(await entry('pnpm'), runner)
    expect(runner.mock.calls[0][1]).toEqual(['audit', '--json', '--audit-level=info', '--optional'])
    const env = runner.mock.calls[0][2].env!
    expect(env).toMatchObject({ NODE_ENV: 'development', npm_config_production: 'null', npm_config_dev: 'null', npm_config_only: 'null', pnpm_config_production: 'null', pnpm_config_dev: 'null', pnpm_config_only: 'null' })
    expect(env.NPM_CONFIG_PRODUCTION).toBeUndefined()
    expect(env.PNPM_CONFIG_ONLY).toBeUndefined()
  })

  it('handles Yarn Classic NDJSON, deduplicates advisory paths, and preserves bitmask exits', async () => {
    const runner = vi.fn<AuditRunner>()
      .mockResolvedValueOnce({ stdout: '1.22.22\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: [
        { type: 'warning', data: 'No license' },
        { type: 'auditAdvisory', data: { advisory } },
        { type: 'auditAdvisory', data: { advisory } },
        { type: 'auditSummary', data: { vulnerabilities: { ...zero, high: 1 } } },
      ].map(value => JSON.stringify(value)).join('\n'), stderr: '', exitCode: 8 })
    const report = await auditProject(await entry('yarn'), runner)
    expect(report.counts.high).toBe(1)
    expect(report.findings).toHaveLength(1)
    expect(runner.mock.calls[1][1]).toEqual(['audit', '--json', '--non-interactive', '--ignore-scripts', '--production=false', '--groups', 'dependencies devDependencies optionalDependencies'])
  })

  it('handles modern Yarn findings and keeps its install-state cache outside the project', async () => {
    let cachePath: string | undefined
    const runner = vi.fn<AuditRunner>()
      .mockResolvedValueOnce({ stdout: '4.12.0\n', stderr: '', exitCode: 0 })
      .mockImplementationOnce(async (_command, _args, options) => {
        cachePath = options.env?.YARN_INSTALL_STATE_PATH
        expect(cachePath).toBeTruthy()
        expect(cachePath?.startsWith(`${directory}${path.sep}`)).toBe(false)
        await writeFile(cachePath!, 'generated cache')
        return { stdout: JSON.stringify({ value: '@scope/package', children: { ID: 123, Issue: 'A test vulnerability', URL: 'https://example.test/advisory', Severity: 'critical', 'Vulnerable Versions': '<2' } }), stderr: '', exitCode: 1 }
      })
    const report = await auditProject(await entry('yarn'), runner)
    expect(report.findings[0]).toMatchObject({ name: '@scope/package', severity: 'critical', range: '<2' })
    expect(runner.mock.calls[1][1]).toEqual(['npm', 'audit', '--json', '--all', '--recursive', '--environment', 'all', '--no-deprecations'])
    await expect(lstat(cachePath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recognizes modern Yarn clean messages and older raw bulk reports', async () => {
    const project = await entry('yarn')
    const runner = vi.fn<AuditRunner>()
      .mockResolvedValueOnce({ stdout: '3.8.7', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ type: 'info', data: 'No audit suggestions' }), stderr: '', exitCode: 0 })
    expect((await auditProject(project, runner)).counts).toEqual(zero)
    const raw = vi.fn<AuditRunner>()
      .mockResolvedValueOnce({ stdout: '3.8.7', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ 'vulnerable-package': [advisory] }), stderr: '', exitCode: 1 })
    expect((await auditProject(project, raw)).counts.high).toBe(1)
  })

  it('supports Bun raw registry responses without falling back to npm', async () => {
    const project = await entry('bun')
    const runner = runnerFor({ 'vulnerable-package': [advisory] }, 1)
    expect((await auditProject(project, runner)).counts.high).toBe(1)
    expect(runner).toHaveBeenCalledWith('bun', ['audit', '--json'], expect.any(Object))
    expect((await auditProject(project, runnerFor({}))).counts).toEqual(zero)
  })

  it.each([
    ['missing report', '', 0],
    ['malformed report', '{broken', 0],
    ['unrecognized report', '{}', 0],
    ['registry error', JSON.stringify({ error: { code: 'E503', summary: 'Unavailable' } }), 1],
    ['nonzero empty report', JSON.stringify(cleanReport), 1],
    ['unexpected exit code', JSON.stringify(npmReport), 127],
    ['malformed count', JSON.stringify({ ...cleanReport, metadata: { vulnerabilities: { ...zero, high: -1 } } }), 0],
    ['unknown severity', JSON.stringify({ advisories: { '123': { ...advisory, severity: 'unknown' } }, metadata: { vulnerabilities: zero } }), 1],
  ])('rejects %s instead of reporting a clean scan', async (_name, stdout, exitCode) => {
    const runner = vi.fn<AuditRunner>().mockResolvedValue({ stdout, stderr: '', exitCode })
    await expect(auditProject(await entry(), runner)).rejects.toThrow('complete, supported audit report')
  })

  it('rejects interrupted or oversized reports even if valid JSON was partially emitted', async () => {
    const project = await entry()
    const runner = vi.fn<AuditRunner>().mockRejectedValue({ killed: true, stdout: JSON.stringify(cleanReport) })
    await expect(auditProject(project, runner)).rejects.toThrow('timed out or was interrupted')
    runner.mockRejectedValue({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: JSON.stringify(cleanReport) })
    await expect(auditProject(project, runner)).rejects.toThrow('8 MB output limit')
    runner.mockRejectedValue({ code: 'ENOENT' })
    await expect(auditProject(project, runner)).rejects.toThrow('npm is not installed')
  })

  it('requires an appropriate regular lockfile before invoking any command', async () => {
    const project = await entry('bun', 'bun.lockb')
    const runner = runnerFor({})
    await expect(auditProject(project, runner)).rejects.toThrow('Binary bun.lockb files')
    await symlink(path.join(directory, 'bun.lockb'), path.join(directory, 'bun.lock'))
    await expect(auditProject(project, runner)).rejects.toThrow('regular bun.lock')
    expect(runner).not.toHaveBeenCalled()
  })

  it('rejects a linked npm shrinkwrap even when a regular package-lock exists', async () => {
    const project = await entry()
    await symlink(path.join(directory, 'package-lock.json'), path.join(directory, 'npm-shrinkwrap.json'))
    const runner = runnerFor(cleanReport)
    await expect(auditProject(project, runner)).rejects.toThrow('regular npm-shrinkwrap.json')
    expect(runner).not.toHaveBeenCalled()
  })

  it.each([['bun', '1.2.14'], ['yarn', '2.3.4'], ['yarn', '1.11.0']] as const)('rejects %s versions without a supported built-in audit command instead of running project scripts', async (manager, version) => {
    const runner = vi.fn<AuditRunner>().mockResolvedValue({ stdout: version, stderr: '', exitCode: 0 })
    await expect(auditProject(await entry(manager), runner)).rejects.toThrow('requires')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0][1]).toEqual(['--version'])
  })

  it('rejects missing package metadata and partial registry coverage', async () => {
    const project = await entry('bun')
    const runner = vi.fn<AuditRunner>()
      .mockResolvedValueOnce({ stdout: '1.4.2', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '{}', stderr: 'Skipped packages because the registry has no audit endpoint', exitCode: 0 })
    await expect(auditProject(project, runner)).rejects.toThrow('complete, supported audit report')
    await rm(path.join(directory, 'package.json'))
    await expect(auditProject(project, runner)).rejects.toThrow('regular package.json')
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('does not return unsafe advisory URLs', async () => {
    const report = { advisories: { 123: { ...advisory, url: 'javascript:alert(1)' } }, metadata: { vulnerabilities: { ...zero, high: 1 } } }
    expect((await auditProject(await entry(), runnerFor(report, 1))).findings[0].url).toBeUndefined()
  })
})
