import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactDoctorProject, type ReactDoctorRunner } from './react-doctor'
import type { RegisteredProject } from './scanner'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-doctor-test-'))) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const finding = { filePath: 'src/App.tsx', line: 5, column: 4, plugin: 'react-doctor', rule: 'alt-text', severity: 'error', message: 'Add alt text.', help: 'Describe the image.', category: 'Accessibility' }
const reportFor = (projectDirectory: string, findings = [finding]) => ({
  schemaVersion: 3, version: '0.9.17', mode: 'full', ok: true, error: null, reactDetected: true,
  projects: [{ directory: projectDirectory, diagnostics: findings, score: { score: 92, label: 'Great' }, skippedChecks: [] as string[], analyzedFiles: ['src/App.tsx'], analyzedFileCount: 1, scannedFileCount: 1, complete: true }],
  diagnostics: findings,
  summary: { score: 92 as number | null, scoreLabel: 'Great' as string | null, errorCount: findings.length, warningCount: 0, totalDiagnosticCount: findings.length },
})
const runnerFor = (report: unknown, exitCode = 0, stderr = '') => vi.fn<ReactDoctorRunner>().mockResolvedValue({ stdout: JSON.stringify(report), stderr, exitCode })
async function entry(): Promise<RegisteredProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { react: '^19.0.0' } }))
  return { directory, root: directory, project: { id: 'test', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: new Date().toISOString() } }
}

describe('React Doctor scanning', () => {
  it('runs the installed CLI with full-project scope, bounded output and selected workspace', async () => {
    const project = await entry()
    const runner = runnerFor(reportFor(directory))
    expect(await reactDoctorProject(project, runner)).toMatchObject({ version: '0.9.17', score: 92, label: 'Great', findings: [finding] })
    expect(runner).toHaveBeenCalledWith(process.execPath, [expect.stringContaining('/react-doctor/bin/react-doctor.js'), directory, '--project', '.', '--json', '--json-compact', '--scope', 'full', '--lint', '--dead-code', '--warnings', '--blocking', 'none', '--no-supply-chain', '--no-cache', '--yes'], expect.objectContaining({ cwd: directory, shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }))
  })

  it('retains findings without inventing a score when the scoring service is unavailable', async () => {
    const project = await entry()
    const report = reportFor(directory)
    report.summary.score = null
    report.summary.scoreLabel = null
    expect(await reactDoctorProject(project, runnerFor(report))).toMatchObject({ score: null, label: 'Score unavailable', findings: [finding], warning: expect.stringContaining('scoring service') })
  })

  it('suppresses misleading scores for partial analysis, even if the tool returns one', async () => {
    const project = await entry()
    const report = reportFor(directory, [])
    report.projects[0].complete = false
    report.projects[0].skippedChecks = ['lint']
    expect(await reactDoctorProject(project, runnerFor(report))).toMatchObject({ score: null, label: 'Incomplete scan', warning: expect.stringContaining('Skipped checks: lint') })
    const partial = { ...reportFor(directory), projects: [{ ...reportFor(directory).projects[0], skippedCheckReasons: { 'lint:partial': 'One worker failed.' } }] }
    expect(await reactDoctorProject(project, runnerFor(partial))).toMatchObject({ score: null, warning: expect.stringContaining('One worker failed.') })
  })

  it('does not show a perfect score when there are no source files', async () => {
    const project = await entry()
    const report = reportFor(directory, [])
    Object.assign(report.projects[0], { scannedFileCount: 0, analyzedFileCount: 0, analyzedFiles: [] })
    expect(await reactDoctorProject(project, runnerFor(report))).toMatchObject({ score: null, warning: expect.stringContaining('no supported source files') })
  })

  it('rejects non-React and invalid fresh manifests before launching', async () => {
    const project = await entry()
    const runner = runnerFor(reportFor(directory))
    await writeFile(path.join(directory, 'package.json'), '{"dependencies":{"vue":"*"}}')
    await expect(reactDoctorProject(project, runner)).rejects.toThrow('declare React')
    await writeFile(path.join(directory, 'package.json'), 'null')
    await expect(reactDoctorProject(project, runner)).rejects.toThrow('valid package.json object')
    await rm(path.join(directory, 'package.json'))
    await writeFile(path.join(directory, 'manifest.json'), '{}')
    await symlink(path.join(directory, 'manifest.json'), path.join(directory, 'package.json'))
    await expect(reactDoctorProject(project, runner)).rejects.toThrow('regular, valid package.json')
    expect(runner).not.toHaveBeenCalled()
  })

  it.each(['react', 'react-dom', 'react-native', 'next', 'expo'])('supports %s declared only as a peer dependency', async dependency => {
    const project = await entry()
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ peerDependencies: { [dependency]: '*' } }))
    expect((await reactDoctorProject(project, runnerFor(reportFor(directory)))).score).toBe(92)
  })

  it.each([
    (report: ReturnType<typeof reportFor>) => ({ ...report, schemaVersion: 1 }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, mode: 'diff' }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, projects: [] }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, projects: [{ ...report.projects[0], directory: '/different-project' }] }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, projects: [...report.projects, ...report.projects] }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, summary: { ...report.summary, score: 101 } }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, summary: { ...report.summary, totalDiagnosticCount: 0 } }),
    (report: ReturnType<typeof reportFor>) => ({ ...report, projects: [{ ...report.projects[0], diagnostics: [{ ...finding, line: -1 }] }] }),
  ])('rejects incomplete, inconsistent, or differently scoped output', async change => {
    const project = await entry()
    await expect(reactDoctorProject(project, runnerFor(change(reportFor(directory))))).rejects.toMatchObject({ status: 502 })
  })

  it('reports process failures, timeout and output limits without treating them as clean scans', async () => {
    const project = await entry()
    await expect(reactDoctorProject(project, runnerFor({}, 2, 'Cannot load config'))).rejects.toThrow('Cannot load config')
    for (const [failure, message] of [[{ killed: true }, 'two-minute limit'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '8 MB output limit'], [{ code: 'ENOENT' }, 'Could not start React Doctor']] as const) {
      await expect(reactDoctorProject(project, vi.fn<ReactDoctorRunner>().mockRejectedValue(failure))).rejects.toThrow(message)
    }
    expect((await reactDoctorProject(project, runnerFor(reportFor(directory), 0, '\u001b[33mConfiguration warning\u001b[0m'))).warning).toBe('Configuration warning')
  })
})

it('scans only the selected workspace package using the real CLI and respects project configuration', async () => {
  const project = await entry()
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'], dependencies: { react: '^19.0.0' } }))
  await writeFile(path.join(directory, 'doctor.config.json'), JSON.stringify({ noScore: true, supplyChain: { enabled: false } }))
  await mkdir(path.join(directory, 'packages/member'), { recursive: true })
  await mkdir(path.join(directory, 'packages/sibling'), { recursive: true })
  for (const name of ['member', 'sibling']) {
    await writeFile(path.join(directory, `packages/${name}/package.json`), JSON.stringify({ name, dependencies: { react: '^19.0.0' } }))
    await writeFile(path.join(directory, `packages/${name}/App.jsx`), 'export default function App() { return <img src="/x.png" /> }')
  }
  const report = await reactDoctorProject({ ...project, directory: path.join(directory, 'packages/member'), workspaceDirectory: directory })
  expect(report.findings.some(item => item.rule === 'alt-text')).toBe(true)
  expect(report.findings.every(item => !item.filePath.includes('sibling'))).toBe(true)
  expect(report.score).toBeNull()
  expect(report.warning).not.toContain('incomplete')
}, 30_000)
