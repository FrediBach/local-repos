import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegisteredProject } from './scanner'
import { testCoverageProject, type TestCoverageRunner } from './test-coverage'
import type { ensureCoverageProvider } from './coverage-tool-cache'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-coverage-test-'))) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const metrics = (total = 10, covered = 7) => Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map(name => [name, { total, covered, skipped: 0, pct: 100 }]))
const summary = (total = 10, covered = 7) => ({ total: metrics(total, covered), [path.join(directory, 'src/App.tsx')]: metrics(total, covered) })
async function entry(manifest: unknown = { devDependencies: { vitest: '*' }, scripts: { test: 'vitest' } }): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest))
  return { directory, root: directory, project: { id: 'test', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: new Date().toISOString() } }
}
async function install(runner = 'vitest', code = '') {
  const packageDirectory = path.join(directory, 'node_modules', runner)
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: runner, version: '1.0.0', bin: { [runner]: './cli.cjs' } }))
  await writeFile(path.join(packageDirectory, 'cli.cjs'), code)
}
async function existing(value: unknown = summary(), filename = 'coverage/coverage-summary.json') {
  await mkdir(path.dirname(path.join(directory, filename)), { recursive: true })
  await writeFile(path.join(directory, filename), typeof value === 'string' ? value : JSON.stringify(value))
}
const outputDirectory = (args: string[]) => args.find(arg => /^--coverage(?:\.reportsDirectory|Directory)=/.test(arg))!.split('=').slice(1).join('=')
function runnerFor(report: unknown = summary(), exitCode = 0, stderr = '') {
  return vi.fn<TestCoverageRunner>(async (_command, args) => {
    await writeFile(path.join(outputDirectory(args), 'coverage-summary.json'), JSON.stringify(report))
    return { stdout: '', stderr, exitCode }
  })
}

describe('native test coverage', () => {
  it('runs installed Vitest once, preserves configuration/provider, replaces output flags, and cleans temporary reports', async () => {
    const project = await entry({ scripts: { test: 'vitest --config "config/test custom.ts" --coverage.provider=istanbul --coverage.reporter=text --coverage.reportsDirectory=public --coverage.thresholds.autoUpdate --watch -u' } })
    await install()
    const runner = runnerFor()
    const report = await testCoverageProject(project, runner)
    expect(report).toMatchObject({ runner: 'vitest', source: 'run', exitCode: 0, metrics: { lines: { covered: 7, total: 10, pct: 70 } }, files: [{ path: 'src/App.tsx' }] })
    expect(report.warning).toBeUndefined()
    const [command, args, options] = runner.mock.calls[0]
    expect(command).toBe(process.execPath)
    expect(args).toEqual(expect.arrayContaining(['run', '--config', 'config/test custom.ts', '--coverage.provider=istanbul', '--coverage.reporter=json-summary', '--coverage.reportOnFailure', '--coverage.thresholds.autoUpdate=false', '--watch=false', '--update=false']))
    expect(args).not.toEqual(expect.arrayContaining(['--coverage.reporter=text', '--coverage.thresholds.autoUpdate', '--watch', '-u']))
    expect(options).toMatchObject({ cwd: directory, shell: false, timeout: 300_000, maxBuffer: 8 * 1024 * 1024, env: { CI: '1' } })
    expect(report.command).toContain('<temporary directory>')
    await expect(access(outputDirectory(args))).rejects.toThrow()
  })

  it.each(['jest', 'react-scripts'])('launches %s through its project executable with JSON coverage and watch disabled', async kind => {
    const project = await entry({ scripts: { test: `${kind}${kind === 'react-scripts' ? ' test' : ''} --config=jest.special.json --watchAll` } })
    await install(kind)
    const runner = runnerFor()
    expect((await testCoverageProject(project, runner)).runner).toBe(kind)
    expect(runner.mock.calls[0][1]).toEqual(expect.arrayContaining(['--config=jest.special.json', '--coverage', '--coverageReporters=json-summary', '--watchAll=false', '--ci', '--updateSnapshot=false']))
    if (kind === 'react-scripts') expect(runner.mock.calls[0][1][1]).toBe('test')
  })

  it('selects the coverage script and its config before other tests and installed dependencies', async () => {
    const project = await entry({ scripts: { 'test:coverage': 'jest --config coverage.config.cjs', test: 'vitest' }, devDependencies: { vitest: '*' } })
    await install('jest')
    const runner = runnerFor()
    expect((await testCoverageProject(project, runner)).runner).toBe('jest')
    expect(runner.mock.calls[0][1]).toContain('coverage.config.cjs')
  })

  it('uses a declared runner without a script, preferring CRA over its Jest dependency', async () => {
    const project = await entry({ devDependencies: { 'react-scripts': '*', jest: '*' } })
    await install('react-scripts')
    expect((await testCoverageProject(project, runnerFor())).runner).toBe('react-scripts')
  })

  it('never installs missing dependencies or silently imports a stale report for a configured native runner', async () => {
    const project = await entry()
    await existing()
    const runner = runnerFor()
    await expect(testCoverageProject(project, runner)).rejects.toThrow('not installed')
    expect(runner).not.toHaveBeenCalled()
  })

  it.each(['v8', 'istanbul'] as const)('prepares a matching missing %s provider outside the project and retries only once', async provider => {
    const project = await entry({ scripts: { test: `NODE_OPTIONS=--no-experimental-webstorage vitest --coverage.provider ${provider}` } })
    await install()
    const manifestBefore = await readFile(path.join(directory, 'package.json'), 'utf8')
    const packageName = `@vitest/coverage-${provider}`
    const prepare = vi.fn<typeof ensureCoverageProvider>().mockResolvedValue({ packageName, version: '1.0.0', modulePath: '/tmp/cached-provider/index.js' })
    let wrapper = ''
    const runner = vi.fn<TestCoverageRunner>()
      .mockResolvedValueOnce({ stdout: '', stderr: ` MISSING DEPENDENCY Cannot find dependency '${packageName}'`, exitCode: 1 })
      .mockImplementationOnce(async (_command, args) => {
        wrapper = args.find(arg => arg.startsWith('--coverage.customProviderModule='))!.split('=').slice(1).join('=')
        // Real coverage clean removes the report directory before collecting; the bridge must survive.
        await rm(outputDirectory(args), { recursive: true })
        expect(await readFile(wrapper, 'utf8')).toContain('startCoverage?.bind(providerModule)')
        expect(await readFile(wrapper, 'utf8')).toContain('project.config?.browser?.enabled')
        await mkdir(outputDirectory(args))
        await writeFile(path.join(outputDirectory(args), 'coverage-summary.json'), JSON.stringify(summary()))
        return { stdout: '', stderr: '', exitCode: 0 }
      })
    const report = await testCoverageProject(project, runner, prepare)
    expect(prepare).toHaveBeenCalledExactlyOnceWith(provider, '1.0.0')
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls[1][1]).toContain('--coverage.provider=custom')
    expect(runner.mock.calls[1][1]).not.toContain(provider)
    expect(runner.mock.calls[1][2].env).toMatchObject({ NODE_OPTIONS: '--no-experimental-webstorage', CI: '1' })
    expect(report).toMatchObject({ source: 'run', metrics: { lines: { pct: 70 } }, tooling: { packageName, version: '1.0.0' } })
    expect(report.warning).toBeUndefined()
    expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(manifestBefore)
    await expect(access(wrapper)).rejects.toThrow()
  })

  it('does not download tooling or rerun tests for ordinary test failures', async () => {
    const project = await entry()
    await install()
    const prepare = vi.fn<typeof ensureCoverageProvider>()
    const runner = runnerFor(summary(), 1, 'AssertionError: wrong value')
    expect((await testCoverageProject(project, runner, prepare)).exitCode).toBe(1)
    expect(prepare).not.toHaveBeenCalled()
    expect(runner).toHaveBeenCalledOnce()
  })

  it('reports setup failures and retains project reports without attempting another test run', async () => {
    const project = await entry()
    await install()
    await existing()
    const runner = vi.fn<TestCoverageRunner>().mockResolvedValue({ stdout: '', stderr: "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'", exitCode: 1 })
    const prepare = vi.fn<typeof ensureCoverageProvider>().mockRejectedValue(new Error('npm cannot reach the registry'))
    await expect(testCoverageProject(project, runner, prepare)).rejects.toThrow('npm cannot reach the registry')
    expect(runner).toHaveBeenCalledOnce()
    await expect(access(outputDirectory(runner.mock.calls[0][1]))).rejects.toThrow()
    await expect(access(path.join(directory, 'coverage/coverage-summary.json'))).resolves.toBeUndefined()
  })

  it('does not repeat setup when the retry fails, and retains useful output from both streams', async () => {
    const project = await entry()
    await install()
    const runner = vi.fn<TestCoverageRunner>().mockResolvedValueOnce({ stdout: '', stderr: "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: 'Missing application dependency', stderr: 'Test startup failed', exitCode: 1 })
    const prepare = vi.fn<typeof ensureCoverageProvider>().mockResolvedValue({ packageName: '@vitest/coverage-v8', version: '1.0.0', modulePath: '/tmp/provider.js' })
    await expect(testCoverageProject(project, runner, prepare)).rejects.toThrow('Test startup failed\nMissing application dependency')
    expect(prepare).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('passes cross-env values to Jest directly without requiring a wrapper executable', async () => {
    const project = await entry({ scripts: { test: 'cross-env NEXT_PUBLIC_STAGE=test MODE="unit tests" jest --runInBand' } })
    await install('jest')
    const runner = runnerFor()
    await testCoverageProject(project, runner)
    expect(runner.mock.calls[0][2].env).toMatchObject({ NEXT_PUBLIC_STAGE: 'test', MODE: 'unit tests' })
    expect(runner.mock.calls[0][1]).toContain('--runInBand')
    expect(runner.mock.calls[0][1]).not.toContain('cross-env')
  })

  it('keeps fresh metrics and warns when tests or coverage thresholds fail', async () => {
    const project = await entry()
    await install()
    expect(await testCoverageProject(project, runnerFor(summary(), 1, 'A test failed'))).toMatchObject({ exitCode: 1, source: 'run', metrics: { lines: { pct: 70 } }, warning: expect.stringContaining('Tests or coverage thresholds failed') })
  })

  it('does not label successful Jest results as limited because it prints progress to stderr', async () => {
    const project = await entry({ scripts: { test: 'jest' } })
    await install('jest')
    const report = await testCoverageProject(project, runnerFor(summary(), 0, 'PASS src/App.test.tsx\nTest Suites: 1 passed, 1 total\nTests: 3 passed, 3 total'))
    expect(report.exitCode).toBe(0)
    expect(report.warning).toBeUndefined()
  })

  it('does not replace failed native coverage with pre-existing reports', async () => {
    const project = await entry()
    await install()
    await existing()
    const runner = vi.fn<TestCoverageRunner>().mockResolvedValue({ stdout: '', stderr: 'Cannot load provider', exitCode: 1 })
    await expect(testCoverageProject(project, runner)).rejects.toThrow('Cannot load provider')
    await expect(access(outputDirectory(runner.mock.calls[0][1]))).rejects.toThrow()
  })

  it.each([
    [{ killed: true }, 'five-minute limit'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '8 MB output limit'],
    [{ code: 'ENOENT', message: 'gone' }, 'Could not start vitest'],
  ])('reports process limits and startup failures', async (failure, message) => {
    const project = await entry()
    await install()
    await expect(testCoverageProject(project, vi.fn<TestCoverageRunner>().mockRejectedValue(failure))).rejects.toThrow(message)
  })

  it('represents empty instrumentation as unavailable rather than 100 percent', async () => {
    const project = await entry()
    await install()
    expect(await testCoverageProject(project, runnerFor(summary(0, 0)))).toMatchObject({ metrics: { lines: { pct: null, total: 0 }, branches: { pct: null } }, warning: expect.stringContaining('No executable lines') })
  })

  it('executes a real local CLI process and collects only its fresh report', async () => {
    const project = await entry()
    await install('vitest', `const fs = require('node:fs'); const arg = process.argv.find(a => a.startsWith('--coverage.reportsDirectory=')); fs.writeFileSync(arg.slice(arg.indexOf('=') + 1) + '/coverage-summary.json', ${JSON.stringify(JSON.stringify(summary()))});`)
    expect(await testCoverageProject(project)).toMatchObject({ runner: 'vitest', metrics: { lines: { pct: 70 } } })
  })
})

describe('imported coverage', () => {
  it.each(['c8 vitest', 'npm run build && vitest', 'vitest --config=$CONFIG', 'jest | tee log', 'node custom-test.cjs'])('imports explicitly instead of changing semantics of complex script %s', async script => {
    const project = await entry({ scripts: { test: script }, devDependencies: { vitest: '*' } })
    await existing()
    const runner = runnerFor()
    expect(await testCoverageProject(project, runner)).toMatchObject({ source: 'existing-report', runner: 'report', reportPath: 'coverage/coverage-summary.json', reportModifiedAt: expect.any(String), warning: expect.stringContaining('tests were not run') })
    expect(runner).not.toHaveBeenCalled()
  })

  it('explains how unsupported setups can produce an importable report', async () => {
    const project = await entry({ scripts: { test: 'playwright test' } })
    await expect(testCoverageProject(project, runnerFor())).rejects.toThrow('coverage/coverage-summary.json')
  })

  it('weights per-file counts, recomputes untrusted percentages, and scopes totals to this project', async () => {
    const project = await entry({})
    await existing({ total: metrics(120, 110), [path.join(directory, 'small.ts')]: metrics(10, 0), [path.join(directory, 'large.ts')]: metrics(90, 90), '../sibling/index.ts': metrics(20, 20) })
    expect(await testCoverageProject(project)).toMatchObject({ metrics: { lines: { total: 100, covered: 90, pct: 90 } }, files: [{ path: 'large.ts' }, { path: 'small.ts' }], warning: expect.stringContaining('Excluded 1') })
  })

  it('warns when summary totals cannot be reconciled with files', async () => {
    const project = await entry({})
    await existing({ total: metrics(10, 10), 'src/app.ts': metrics(10, 2) })
    expect(await testCoverageProject(project)).toMatchObject({ metrics: { lines: { pct: 20 } }, warning: expect.stringContaining('recalculated') })
  })

  it('reads LCOV with unavailable statement coverage and weighted line totals', async () => {
    const project = await entry({})
    await existing('TN:\nSF:src/a.ts\nFN:1,a\nFNF:1\nFNH:0\nDA:1,0\nDA:2,1\nLF:2\nLH:1\nBRF:0\nBRH:0\nend_of_record\nSF:src/b.ts\nDA:1,1\nLF:1\nLH:1\nFNF:1\nFNH:1\nBRF:2\nBRH:1\nend_of_record\n', 'coverage/lcov.info')
    expect(await testCoverageProject(project)).toMatchObject({ reportPath: 'coverage/lcov.info', metrics: { lines: { covered: 2, total: 3, pct: 66.67 }, statements: null, functions: { pct: 50 }, branches: { pct: 50 } }, warning: expect.stringContaining('does not include statement') })
  })

  it('does not fabricate absent LCOV function and branch totals', async () => {
    const project = await entry({})
    await existing('SF:src/a.ts\nDA:1,1\nend_of_record\n', 'lcov.info')
    expect((await testCoverageProject(project)).metrics).toEqual({ lines: { covered: 1, total: 1, pct: 100 }, statements: null, functions: null, branches: null })
  })

  it.each([
    '{', { total: metrics(-1, 0) }, { total: metrics(1, 2) }, { total: metrics(1.5, 1) },
    { total: { lines: { covered: 1, total: 1 } } },
    { total: metrics(), '../outside.ts': metrics() },
    { total: metrics(), 'src/a.ts': metrics(), './src/a.ts': metrics() },
  ])('rejects malformed and out-of-scope summaries', async report => {
    const project = await entry({})
    await existing(report)
    await expect(testCoverageProject(project)).rejects.toMatchObject({ status: 502 })
  })

  it.each([
    'SF:a.ts\nLF:1\nLH:2\nend_of_record\n',
    'SF:a.ts\nDA:1,1\nLF:1\nLH:0\nend_of_record\n',
    'SF:a.ts\nDA:1,1\n',
    'SF:a.ts\nDA:1,1\nend_of_record\nSF:a.ts\nDA:2,1\nend_of_record\n',
  ])('rejects inconsistent or incomplete LCOV', async report => {
    const project = await entry({})
    await existing(report, 'coverage/lcov.info')
    await expect(testCoverageProject(project)).rejects.toMatchObject({ status: 502 })
  })

  it('rejects report file symlinks and symlink directories that escape the project', async () => {
    const project = await entry({})
    await existing(summary(), 'source.json')
    await mkdir(path.join(directory, 'coverage'))
    await symlink(path.join(directory, 'source.json'), path.join(directory, 'coverage/coverage-summary.json'))
    await expect(testCoverageProject(project)).rejects.toThrow('regular files inside the project')
    await rm(path.join(directory, 'coverage'), { recursive: true })
    await symlink(os.tmpdir(), path.join(directory, 'coverage'))
    // Missing paths still fail closed, never reading a report from another directory.
    await expect(testCoverageProject(project)).rejects.toThrow()
  })

  it('bounds report size and rejects symbolic package manifests', async () => {
    const project = await entry({})
    await existing(' '.repeat(8 * 1024 * 1024 + 1))
    await expect(testCoverageProject(project)).rejects.toThrow('smaller than 8 MB')
    await rm(path.join(directory, 'package.json'))
    await writeFile(path.join(directory, 'manifest.json'), '{}')
    await symlink(path.join(directory, 'manifest.json'), path.join(directory, 'package.json'))
    await expect(testCoverageProject(project)).rejects.toThrow('regular, valid package.json')
  })
})
