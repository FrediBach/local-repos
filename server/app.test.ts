import { lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { request, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { devCommand } from './runtime'
import type { PackageAudit, PackageOutdated, PackageUnused, ProjectStorage, RepoProject } from '../src/types'
import * as packageAudit from './package-audit'
import * as packageOutdated from './package-outdated'
import * as packageUnused from './package-unused'
import * as packageUpdate from './package-update'
import * as projectStorage from './project-storage'
import * as projectScripts from './project-scripts'

let helper: ReturnType<typeof createApp>
let server: Server
let address: string
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-api-test-'))
  helper = createApp()
  await new Promise<void>((resolve, reject) => {
    server = helper.app.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve())
  })
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('No test server address')
  address = `http://127.0.0.1:${bound.port}`
})
afterEach(async () => {
  vi.restoreAllMocks()
  await helper.runtime.shutdown()
  if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(directory, { recursive: true, force: true })
})

async function post(endpoint: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${address}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1', ...headers }, body: JSON.stringify(body) })
}

async function createProject(scripts: Record<string, string> = {}): Promise<RepoProject> {
  const projectDir = path.join(directory, 'project')
  await mkdir(projectDir)
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture', scripts }))
  const response = await post('/api/scan', { path: directory })
  expect(response.status).toBe(200)
  return (await response.json()).projects[0] as RepoProject
}

describe('local helper API security', () => {
  it.each([undefined, null, 'arbitrary-command', 42, {}])('rejects unsupported open targets before project lookup: %j', async app => {
    const lookup = vi.spyOn(helper.registry, 'get')
    const response = await post('/api/projects/unknown/open', { app })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Choose VS Code, Sourcetree, or the system file browser.' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(['vscode', 'sourcetree', 'folder'])('still validates project registration before opening %s', async app => {
    const lookup = vi.spyOn(helper.registry, 'get')
    const response = await post('/api/projects/unknown/open', { app })
    expect(response.status).toBe(404)
    expect(lookup).toHaveBeenCalledExactlyOnceWith('unknown')
  })

  it('serves daily summaries only for registered projects with a valid day and app origin', async () => {
    const query = { from: '2026-10-07T22:00:00.000Z', to: '2026-10-08T22:00:00.000Z' }
    expect((await post('/api/projects/unknown/daily-summary', query)).status).toBe(404)
    const project = await createProject()
    const endpoint = `/api/projects/${project.id}/daily-summary`
    expect(await (await post(endpoint, query)).json()).toEqual({ available: false, shallow: false, commits: [] })
    expect((await post(endpoint, {})).status).toBe(400)
    expect((await post(endpoint, query, { Origin: 'https://untrusted.example' })).status).toBe(403)
    await rename(path.join(directory, 'project'), path.join(directory, 'moved'))
    expect((await post(endpoint, query)).status).toBe(404)
  })
  it('checks package changes only in registered workspaces and includes shared monorepo lockfiles', async () => {
    expect(await (await post('/api/package-changes', { path: directory })).json()).toEqual({ fingerprints: null })
    const root = path.join(directory, 'repo')
    await mkdir(path.join(root, 'packages/member'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }))
    await writeFile(path.join(root, 'packages/member/package.json'), JSON.stringify({ name: 'member' }))
    const scan = await (await post('/api/scan', { path: directory })).json()
    const poll = async () => (await (await post('/api/package-changes', { path: scan.rootPath })).json()).fingerprints as Record<string, string>
    const initial = await poll()
    expect(initial).toEqual(Object.fromEntries(scan.projects.map((project: RepoProject) => [project.id, project.packageFingerprint])))
    expect(Object.keys(initial)).toHaveLength(2)
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}')
    const changed = await poll()
    for (const id of Object.keys(initial)) expect(changed[id]).not.toBe(initial[id])
    expect((await post('/api/package-changes', { path: scan.rootPath }, { Origin: 'https://untrusted.example' })).status).toBe(403)
    const missingHeader = await fetch(`${address}/api/package-changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: scan.rootPath }) })
    expect(missingHeader.status).toBe(403)
  })

  it('launches only a selected current script in a registered project', async () => {
    const launch = vi.spyOn(projectScripts, 'openScriptTerminal').mockResolvedValue(undefined)
    expect((await post('/api/projects/unknown/run-script', { name: 'test', command: 'vitest run' })).status).toBe(404)
    const project = await createProject({ test: 'vitest run', prepare: 'husky' })
    const endpoint = `/api/projects/${project.id}/run-script`
    for (const body of [{}, { name: 'missing', command: 'echo unsafe' }, { name: 'test', command: 'echo unsafe' }, { name: 'prepare', command: 'husky' }]) {
      expect((await post(endpoint, body)).ok).toBe(false)
    }
    expect(launch).not.toHaveBeenCalled()
    const denied = await post(endpoint, { name: 'test', command: 'vitest run' }, { Origin: 'https://untrusted.example' })
    expect(denied.status).toBe(403)
    expect((await post(endpoint, { name: 'test', command: 'vitest run' })).status).toBe(200)
    expect(launch).toHaveBeenCalledExactlyOnceWith(helper.registry.lookup(project.id), 'test')
    expect(await helper.runtime.status(project.id)).toEqual({ status: 'stopped' })
    await writeFile(path.join(directory, 'project/package.json'), JSON.stringify({ scripts: { test: 'node changed.js' } }))
    expect((await post(endpoint, { name: 'test', command: 'vitest run' })).status).toBe(409)
    expect(launch).toHaveBeenCalledOnce()
  })

  it('serves Git history only for registered, still-accessible project paths', async () => {
    expect((await post('/api/projects/unknown/history')).status).toBe(404)
    const project = await createProject()
    const result = await post(`/api/projects/${project.id}/history`)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ available: false, commits: [], total: 0 })
    expect((await post(`/api/projects/${project.id}/history`, { offset: -1 })).status).toBe(400)
    const moved = path.join(directory, 'moved')
    await rename(path.join(directory, 'project'), moved)
    expect((await post(`/api/projects/${project.id}/history`)).status).toBe(404)
  })

  it('reports health and blocks foreign origins, foreign hosts, and cross-site requests', async () => {
    expect(await (await fetch(`${address}/api/health`)).json()).toMatchObject({ ok: true })
    const unsafeHeaders: Record<string, string>[] = [{ Origin: 'https://untrusted.example' }, { Host: 'attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'null' }]
    for (const headers of unsafeHeaders) {
      // Node's fetch rewrites the Host header, so use a raw HTTP request here.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${address}/api/health`, { headers }, (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        req.on('error', reject)
        req.end()
      })
      expect(status, JSON.stringify(headers)).toBe(403)
    }
    const local = await fetch(`${address}/api/health`, { headers: { Origin: 'http://localhost:5173' } })
    expect(local.status).toBe(200)
    expect((await fetch(`${address}/api/health`, { headers: { Origin: 'http://127.0.0.1:5180' } })).status).toBe(200)
  })

  it('requires an application header for mutations and registers only scanned ids', async () => {
    const denied = await fetch(`${address}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: directory }) })
    expect(denied.status).toBe(403)
    expect((await post('/api/projects/unknown/start')).status).toBe(404)
    const project = await createProject()
    expect(await (await fetch(`${address}/api/projects/${project.id}/status`)).json()).toEqual({ dev: { status: 'stopped' } })
    const start = await post(`/api/projects/${project.id}/start`)
    expect(start.status).toBe(400)
    expect((await start.json()).error).toContain('dev script')
    expect((await post(`/api/projects/${project.id}/open`, { app: 'arbitrary-command' })).status).toBe(400)
    expect((await fetch(`${address}/api/screenshots/${project.id}.png`)).status).toBe(404)
  })

  it('returns useful input errors without accepting arbitrary file retrieval', async () => {
    expect((await post('/api/scan', { path: './relative' })).status).toBe(400)
    const badJson = await fetch(`${address}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1' }, body: '{' })
    expect(badJson.status).toBe(400)
    expect((await fetch(`${address}/api/files?path=/etc/passwd`)).status).toBe(404)
  })

  it('rejects an invalid capture source before starting a server or browser', async () => {
    const project = await createProject({ start: 'node dev.cjs' })
    const capture = vi.spyOn(helper.runtime, 'screenshot')
    const response = await post(`/api/projects/${project.id}/screenshot`, { source: 'https://example.com' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('automatic, local, or website')
    expect(capture).not.toHaveBeenCalled()
    expect(await helper.runtime.status(project.id)).toEqual({ status: 'stopped' })
  })
})

describe('project storage and package actions', () => {
  it('validates update levels and blocks sibling maintenance until an update completes', async () => {
    await mkdir(path.join(directory, 'apps/web'), { recursive: true })
    await mkdir(path.join(directory, 'apps/admin'), { recursive: true })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'studio', workspaces: ['apps/*'] }))
    await writeFile(path.join(directory, 'apps/web/package.json'), '{"name":"web"}')
    await writeFile(path.join(directory, 'apps/admin/package.json'), '{"name":"admin"}')
    const scan = await (await post('/api/scan', { path: directory })).json()
    const web = scan.projects.find((project: RepoProject) => project.name === 'web')!
    const admin = scan.projects.find((project: RepoProject) => project.name === 'admin')!
    expect((await post(`/api/projects/${web.id}/update-packages`, { level: 'major' })).status).toBe(400)
    const updateResult = { level: 'patch' as const, packages: [{ name: 'alpha', from: '1.0.0', to: '1.0.1' }], updatedAt: new Date().toISOString(), skipped: [] }
    let finish!: (result: typeof updateResult) => void
    const update = vi.spyOn(packageUpdate, 'updateProject').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const updating = helper.runtime.updatePackages(web.id, 'patch')
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    await expect(helper.runtime.start(admin.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.runScript(admin.id, 'test', 'vitest run')).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.outdated(admin.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.unused(admin.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.deleteNodeModules(admin.id, true)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.updatePackages(admin.id, 'minor')).rejects.toMatchObject({ status: 409 })
    finish(updateResult)
    expect(await updating).toEqual(updateResult)
    expect(helper.registry.lookup(web.id).project.packageUpdate).toEqual(updateResult)
    update.mockResolvedValueOnce(updateResult)
    expect((await post(`/api/projects/${admin.id}/update-packages`, { level: 'minor' })).status).toBe(200)
  })

  it('invalidates saved reports after a failed update and releases maintenance', async () => {
    const project = await createProject()
    const entry = helper.registry.lookup(project.id)
    entry.project.outdated = outdatedResult
    entry.project.audit = auditResult
    entry.project.unused = unusedResult
    vi.spyOn(packageUpdate, 'updateProject').mockRejectedValueOnce(new Error('Install failed'))
    await expect(helper.runtime.updatePackages(project.id, 'minor')).rejects.toThrow('Install failed')
    expect(entry.project.outdated).toBeUndefined()
    expect(entry.project.audit).toBeUndefined()
    expect(entry.project.unused).toBeUndefined()
    vi.spyOn(packageOutdated, 'outdatedProject').mockResolvedValue(outdatedResult)
    expect(await helper.runtime.outdated(project.id)).toEqual(outdatedResult)
  })

  const auditResult: PackageAudit = {
    manager: 'npm', scannedAt: '2026-10-07T12:00:00.000Z',
    counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    findings: [{ name: 'fixture-package', severity: 'high', title: 'Fixture advisory', range: '<2.0.0', fixAvailable: true }],
  }
  const storageResult: ProjectStorage = { totalBytes: 4096, nodeModulesBytes: 0, hasNodeModules: false, measuredAt: '2026-10-07T12:00:00.000Z', partial: false }
  const outdatedResult: PackageOutdated = {
    manager: 'npm', scannedAt: '2026-10-07T12:00:00.000Z', score: 0.1, level: 'low',
    findings: [{ name: 'fixture-package', current: '1.0.0', wanted: '1.0.1', latest: '1.0.1', change: 'patch', majorGap: 0, score: 0.1 }],
  }
  const unusedResult: PackageUnused = { scannedAt: '2026-10-08T12:00:00.000Z', knipVersion: '6.40.0', findings: [{ name: 'fixture-package', version: '^1.0.0', kind: 'devDependencies', line: 5 }] }

  it('saves unused results across rescans, preserves them after failures, and permits retries', async () => {
    const project = await createProject()
    const unused = vi.spyOn(packageUnused, 'unusedProject').mockResolvedValueOnce(unusedResult)
    const endpoint = `/api/projects/${project.id}/unused`
    expect((await post(endpoint, {}, { Origin: 'https://untrusted.example' })).status).toBe(403)
    const response = await post(endpoint)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ unused: unusedResult })
    expect(unused).toHaveBeenCalledExactlyOnceWith(helper.registry.lookup(project.id))
    expect((await (await post('/api/scan', { path: directory })).json()).projects[0].unused).toEqual(unusedResult)
    unused.mockRejectedValueOnce(new Error('Configuration failed'))
    await expect(helper.runtime.unused(project.id)).rejects.toThrow('Configuration failed')
    expect(helper.registry.lookup(project.id).project.unused).toEqual(unusedResult)
    unused.mockResolvedValueOnce({ ...unusedResult, findings: [] })
    expect((await (await post(endpoint)).json()).unused.findings).toEqual([])
  })

  it('deduplicates unused scans and prevents sibling dependency changes until they finish', async () => {
    await mkdir(path.join(directory, 'packages/member'), { recursive: true })
    await writeFile(path.join(directory, 'package.json'), '{"name":"root","workspaces":["packages/*"]}')
    await writeFile(path.join(directory, 'packages/member/package.json'), '{"name":"member"}')
    const scan = await (await post('/api/scan', { path: directory })).json()
    const root = scan.projects.find((project: RepoProject) => project.name === 'root')!
    const member = scan.projects.find((project: RepoProject) => project.name === 'member')!
    let finish!: (result: PackageUnused) => void
    const unused = vi.spyOn(packageUnused, 'unusedProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = helper.runtime.unused(member.id)
    const second = helper.runtime.unused(member.id)
    await vi.waitFor(() => expect(unused).toHaveBeenCalledOnce())
    await expect(helper.runtime.deleteNodeModules(root.id, true)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.updatePackages(root.id, 'patch')).rejects.toMatchObject({ status: 409 })
    finish(unusedResult)
    expect(await first).toEqual(unusedResult)
    expect(await second).toEqual(unusedResult)
    vi.spyOn(packageUpdate, 'updateProject').mockResolvedValue({ level: 'patch', packages: [], skipped: [], updatedAt: new Date().toISOString() })
    await helper.runtime.updatePackages(root.id, 'patch')
    expect(helper.registry.lookup(member.id).project.unused).toBeUndefined()
  })

  it('rejects unknown ids for every maintenance action', async () => {
    const audit = vi.spyOn(packageAudit, 'auditProject').mockResolvedValue(auditResult)
    const outdated = vi.spyOn(packageOutdated, 'outdatedProject').mockResolvedValue(outdatedResult)
    for (const action of ['storage', 'delete-node-modules', 'audit', 'outdated', 'unused', 'update-packages']) {
      expect((await post(`/api/projects/unknown/${action}`, { confirm: true })).status).toBe(404)
    }
    expect(audit).not.toHaveBeenCalled()
    expect(outdated).not.toHaveBeenCalled()
  })

  it('requires explicit deletion confirmation and stores refreshed usage after fixture cleanup', async () => {
    const project = await createProject()
    const modules = path.join(directory, 'project', 'node_modules')
    await mkdir(modules)
    await writeFile(path.join(modules, 'fixture.js'), 'temporary dependency')
    await writeFile(path.join(directory, 'project', 'package-lock.json'), 'fixture lockfile')
    const usage = await post(`/api/projects/${project.id}/storage`)
    expect(usage.status).toBe(200)
    expect(await usage.json()).toMatchObject({ storage: { hasNodeModules: true, partial: false } })
    for (const confirm of [undefined, false, 'true']) {
      expect((await post(`/api/projects/${project.id}/delete-node-modules`, { confirm })).status).toBe(400)
    }
    expect((await lstat(modules)).isDirectory()).toBe(true)
    const removed = await post(`/api/projects/${project.id}/delete-node-modules`, { confirm: true })
    expect(removed.status).toBe(200)
    const { storage } = await removed.json()
    expect(storage).toMatchObject({ hasNodeModules: false, nodeModulesBytes: 0, partial: false })
    expect(helper.registry.lookup(project.id).project.storage).toEqual(storage)
    await expect(lstat(modules)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(directory, 'project', 'package-lock.json'), 'utf8')).toBe('fixture lockfile')
  })

  it('returns audit findings and stores them on the registered project', async () => {
    const project = await createProject()
    const audit = vi.spyOn(packageAudit, 'auditProject').mockResolvedValue(auditResult)
    const response = await post(`/api/projects/${project.id}/audit`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ audit: auditResult })
    expect(audit).toHaveBeenCalledExactlyOnceWith(helper.registry.lookup(project.id))
    expect(helper.registry.lookup(project.id).project.audit).toEqual(auditResult)
  })

  it('returns outdated findings and retains them across directory rescans', async () => {
    const project = await createProject()
    const outdated = vi.spyOn(packageOutdated, 'outdatedProject').mockResolvedValue(outdatedResult)
    const response = await post(`/api/projects/${project.id}/outdated`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outdated: outdatedResult })
    expect(outdated).toHaveBeenCalledExactlyOnceWith(helper.registry.lookup(project.id))
    expect(helper.registry.lookup(project.id).project.outdated).toEqual(outdatedResult)
    const rescan = await (await post('/api/scan', { path: directory })).json()
    expect(rescan.projects[0].outdated).toEqual(outdatedResult)
  })

  it('preserves the last outdated result after failure and permits a later retry', async () => {
    const project = await createProject()
    helper.registry.lookup(project.id).project.outdated = outdatedResult
    const freshResult: PackageOutdated = { ...outdatedResult, findings: [], score: 0, level: 'current' }
    const outdated = vi.spyOn(packageOutdated, 'outdatedProject')
      .mockRejectedValueOnce(new Error('Fixture registry unavailable'))
      .mockResolvedValueOnce(freshResult)
    await expect(helper.runtime.outdated(project.id)).rejects.toThrow('Fixture registry unavailable')
    expect(helper.registry.lookup(project.id).project.outdated).toEqual(outdatedResult)
    expect(await helper.runtime.outdated(project.id)).toEqual(freshResult)
    expect(helper.registry.lookup(project.id).project.outdated).toEqual(freshResult)
    expect(outdated).toHaveBeenCalledTimes(2)
    expect(await helper.runtime.deleteNodeModules(project.id, true)).toMatchObject({ hasNodeModules: false })
  })

  it('blocks cleanup while the server is running or still stopping, and allows package scans while running', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('ready')).listen(Number(process.env.PORT), process.env.HOST)`)
    vi.spyOn(packageAudit, 'auditProject').mockResolvedValue(auditResult)
    vi.spyOn(packageOutdated, 'outdatedProject').mockResolvedValue(outdatedResult)
    expect((await helper.runtime.start(project.id)).status).toBe('running')
    expect((await post(`/api/projects/${project.id}/delete-node-modules`, { confirm: true })).status).toBe(409)
    expect((await post(`/api/projects/${project.id}/audit`)).status).toBe(200)
    expect((await post(`/api/projects/${project.id}/outdated`)).status).toBe(200)
    await helper.runtime.stop(project.id)
    expect((await post(`/api/projects/${project.id}/delete-node-modules`, { confirm: true })).status).toBe(409)
  }, 15_000)

  it('reserves cleanup before awaiting filesystem access and releases the reservation on failure', async () => {
    const project = await createProject()
    let rejectRemoval!: (error: Error) => void
    const remove = vi.spyOn(projectStorage, 'removeProjectNodeModules').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRemoval = reject }))
    const deletion = helper.runtime.deleteNodeModules(project.id, true).catch(error => error)
    await expect(helper.runtime.start(project.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.screenshot(project.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.audit(project.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.outdated(project.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.storage(project.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    rejectRemoval(new Error('Fixture deletion failure'))
    expect(await deletion).toMatchObject({ message: 'Fixture deletion failure' })
    expect(await helper.runtime.storage(project.id)).toMatchObject({ hasNodeModules: false })
  })

  it('refuses cleanup during pending starts and captures before either acquires a server', async () => {
    const project = await createProject()
    const start = helper.runtime.start(project.id).catch(error => error)
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    await start
    const { chromium } = await import('playwright')
    vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Fixture browser unavailable'))
    const capture = helper.runtime.screenshot(project.id).catch(error => error)
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    await capture
    expect(await helper.runtime.deleteNodeModules(project.id, true)).toMatchObject({ hasNodeModules: false })
  })

  it('coalesces package and disk scans and prevents deletion until all finish', async () => {
    const project = await createProject()
    let resolveAudit!: (audit: PackageAudit) => void
    let resolveStorage!: (storage: ProjectStorage) => void
    let resolveOutdated!: (outdated: PackageOutdated) => void
    const audit = vi.spyOn(packageAudit, 'auditProject').mockImplementationOnce(() => new Promise(resolve => { resolveAudit = resolve }))
    const measure = vi.spyOn(projectStorage, 'measureProjectStorage').mockImplementationOnce(() => new Promise(resolve => { resolveStorage = resolve }))
    const outdated = vi.spyOn(packageOutdated, 'outdatedProject').mockImplementationOnce(() => new Promise(resolve => { resolveOutdated = resolve }))
    const audits = [helper.runtime.audit(project.id), helper.runtime.audit(project.id)]
    const scans = [helper.runtime.storage(project.id), helper.runtime.storage(project.id)]
    const outdatedScans = [helper.runtime.outdated(project.id), helper.runtime.outdated(project.id)]
    await vi.waitFor(() => { expect(audit).toHaveBeenCalledOnce(); expect(measure).toHaveBeenCalledOnce(); expect(outdated).toHaveBeenCalledOnce() })
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    resolveAudit(auditResult)
    expect(await Promise.all(audits)).toEqual([auditResult, auditResult])
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    resolveStorage(storageResult)
    expect(await Promise.all(scans)).toEqual([storageResult, storageResult])
    await expect(helper.runtime.deleteNodeModules(project.id, true)).rejects.toMatchObject({ status: 409 })
    resolveOutdated(outdatedResult)
    expect(await Promise.all(outdatedScans)).toEqual([outdatedResult, outdatedResult])
    expect(await helper.runtime.deleteNodeModules(project.id, true)).toMatchObject({ hasNodeModules: false })
  })

  it('waits for an in-flight outdated scan on shutdown and rejects new scans', async () => {
    const project = await createProject()
    let resolveOutdated!: (outdated: PackageOutdated) => void
    const outdated = vi.spyOn(packageOutdated, 'outdatedProject').mockImplementationOnce(() => new Promise(resolve => { resolveOutdated = resolve }))
    const scan = helper.runtime.outdated(project.id)
    await vi.waitFor(() => expect(outdated).toHaveBeenCalledOnce())
    let stopped = false
    const shutdown = helper.runtime.shutdown().then(() => { stopped = true })
    await expect(helper.runtime.outdated(project.id)).rejects.toMatchObject({ status: 503 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(stopped).toBe(false)
    resolveOutdated(outdatedResult)
    expect(await scan).toEqual(outdatedResult)
    await shutdown
    expect(stopped).toBe(true)
  })
})

describe('dev server lifecycle', () => {
  it('runs a project with only a start script and stops its server', async () => {
    const project = await createProject({ start: 'node start.cjs' })
    await writeFile(path.join(directory, 'project', 'start.cjs'), `require('node:http').createServer((req, res) => res.end('start script ready')).listen(Number(process.env.PORT), process.env.HOST)`)
    const response = await post(`/api/projects/${project.id}/start`)
    expect(response.status).toBe(200)
    const { dev } = await response.json()
    expect(dev.status).toBe('running')
    expect(await (await fetch(dev.url)).text()).toBe('start script ready')
    expect(await (await post(`/api/projects/${project.id}/stop`)).json()).toEqual({ dev: { status: 'stopped' } })
    await expect(fetch(dev.url, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()
  }, 15_000)

  it('discovers a custom server’s actual address and base path when it ignores PORT', async () => {
    const project = await createProject({ dev: 'node custom.cjs' })
    await writeFile(path.join(directory, 'project', 'custom.cjs'), `
      const server = require('node:http').createServer((req, res) => {
        if (req.url !== '/project-preview/') {
          res.statusCode = 404;
          return res.end('Use the project base path');
        }
        res.end('custom project ready');
      });
      server.listen(0, '127.0.0.1', () => {
        process.stdout.write('\\u001b[32mReady at http://local');
        setTimeout(() => process.stdout.write('host:' + server.address().port + '/project-preview/\\u001b[0m\\n'), 30);
      });
    `)
    const response = await post(`/api/projects/${project.id}/start`)
    expect(response.status).toBe(200)
    const { dev } = await response.json()
    expect(dev.status).toBe('running')
    expect(dev.url).toMatch(/^http:\/\/localhost:\d+\/project-preview\/$/)
    expect(await (await fetch(dev.url)).text()).toBe('custom project ready')
    expect((await fetch(new URL('/', dev.url))).status).toBe(404)
    expect(await helper.runtime.status(project.id)).toEqual(dev)
    await post(`/api/projects/${project.id}/stop`)
    await expect(fetch(dev.url, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()
  }, 15_000)

  it('starts only on request, exposes logs, survives rescan, and stops its process', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('fixture ready')).listen(Number(process.env.PORT), process.env.HOST, () => console.log('fixture started'))`)
    const start = await post(`/api/projects/${project.id}/start`)
    const { dev } = await start.json()
    expect(dev.status).toBe('running')
    expect(dev.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await (await fetch(dev.url)).text()).toBe('fixture ready')
    expect((await (await fetch(`${address}/api/projects/${project.id}/logs`)).json()).logs).toContain('fixture started')
    const rescan = await (await post('/api/scan', { path: directory })).json()
    expect(rescan.projects[0].dev.status).toBe('running')
    expect(await (await post(`/api/projects/${project.id}/stop`)).json()).toEqual({ dev: { status: 'stopped' } })
    expect(await (await fetch(`${address}/api/projects/${project.id}/status`)).json()).toEqual({ dev: { status: 'stopped' } })
    await expect(fetch(dev.url, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()
  }, 15_000)

  it('builds loopback-only Vite and Next.js commands without a shell', () => {
    const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scannedAt: new Date().toISOString(), packageManager: 'npm', scripts: { dev: 'vite' } }
    const base = { directory, root: directory, project }
    expect(devCommand(base, 4567)).toMatchObject({ args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4567', '--strictPort'] })
    base.project.scripts.dev = 'next dev --turbopack'
    expect(devCommand(base, 4567).args).toContain('--hostname')
    base.project.packageManager = 'pnpm'
    expect(devCommand(base, 4567).args).toEqual(['run', 'dev', '--hostname', '127.0.0.1', '--port', '4567'])
    expect(() => devCommand(base, 4567, 'win32')).toThrow('Windows are not supported')
  })

  it('cleans up a temporary server when screenshot setup fails and preserves a user-started server', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('preview')).listen(Number(process.env.PORT), process.env.HOST)`)
    const { chromium } = await import('playwright')
    vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Browser executable missing'))
    const capture = await post(`/api/projects/${project.id}/screenshot`)
    expect(capture.status).toBe(503)
    expect((await capture.json()).error).toContain('npx playwright install chromium')
    expect(await (await fetch(`${address}/api/projects/${project.id}/status`)).json()).toEqual({ dev: { status: 'stopped' } })
    expect((await (await post(`/api/projects/${project.id}/start`)).json()).dev.status).toBe('running')
    expect((await post(`/api/projects/${project.id}/screenshot`)).status).toBe(503)
    expect((await (await fetch(`${address}/api/projects/${project.id}/status`)).json()).dev.status).toBe('running')
  }, 15_000)

  it('cancels a pending start and keeps a rapid replacement running after old child exit', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `setTimeout(() => require('node:http').createServer((req, res) => res.end('replacement')).listen(Number(process.env.PORT), process.env.HOST), 150)`)
    const firstStart = helper.runtime.start(project.id)
    await vi.waitFor(async () => expect((await helper.runtime.status(project.id)).status).toBe('starting'))
    await helper.runtime.stop(project.id)
    const replacement = await helper.runtime.start(project.id)
    await firstStart
    expect(replacement.status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await helper.runtime.status(project.id)).toEqual(replacement)
    expect(await (await fetch(replacement.url!)).text()).toBe('replacement')
  }, 15_000)

  it('can stop a process after the project directory moves', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('ready')).listen(Number(process.env.PORT), process.env.HOST)`)
    const started = await helper.runtime.start(project.id)
    expect(started.status).toBe('running')
    await rename(path.join(directory, 'project'), path.join(directory, 'moved-project'))
    expect(await helper.runtime.stop(project.id)).toEqual({ status: 'stopped' })
    expect(await helper.runtime.status(project.id)).toEqual({ status: 'stopped' })
    await expect(fetch(started.url!, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()
  }, 15_000)

  it('does not let old screenshot cleanup stop a replacement server', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('preview')).listen(Number(process.env.PORT), process.env.HOST)`)
    const { chromium } = await import('playwright')
    let rejectLaunch!: (reason: Error) => void
    const launch = vi.spyOn(chromium, 'launch').mockImplementation(() => new Promise((_resolve, reject) => { rejectLaunch = reject }))
    const capture = helper.runtime.screenshot(project.id).catch((error: Error) => error)
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce())
    await helper.runtime.stop(project.id)
    const replacement = await helper.runtime.start(project.id)
    rejectLaunch(new Error('Simulated late launch failure'))
    expect(await capture).toBeInstanceOf(Error)
    expect(await helper.runtime.status(project.id)).toEqual(replacement)
    expect(await (await fetch(replacement.url!)).text()).toBe('preview')
  }, 15_000)

  it('keeps a temporary preview server alive when the user explicitly starts it during capture', async () => {
    const project = await createProject({ dev: 'node dev.cjs' })
    await writeFile(path.join(directory, 'project', 'dev.cjs'), `require('node:http').createServer((req, res) => res.end('preview')).listen(Number(process.env.PORT), process.env.HOST)`)
    const { chromium } = await import('playwright')
    let rejectLaunch!: (reason: Error) => void
    const launch = vi.spyOn(chromium, 'launch').mockImplementation(() => new Promise((_resolve, reject) => { rejectLaunch = reject }))
    const capture = helper.runtime.screenshot(project.id).catch((error: Error) => error)
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce())
    const kept = await helper.runtime.start(project.id)
    rejectLaunch(new Error('Simulated late launch failure'))
    await capture
    expect(await helper.runtime.status(project.id)).toEqual(kept)
    expect(await (await fetch(kept.url!)).text()).toBe('preview')
  }, 15_000)
})
