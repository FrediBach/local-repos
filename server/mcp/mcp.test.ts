import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath, chmod, rename, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { request, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createApp } from '../app'
import { loadPolicy, rootId, type McpPolicy } from './policy'
import { Operations } from '../operations'
import * as auditService from '../package-audit'
import type { PackageAudit } from '../../src/types'

const exec = promisify(execFile)
const token = 'a'.repeat(48), otherToken = 'b'.repeat(48)
let temp: string, root: string, privateRoot: string, configPath: string, policy: McpPolicy
let helper: ReturnType<typeof createApp>, server: Server, url: string
const clients: Client[] = []

beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-mcp-')))
  root = path.join(temp, 'projects'); privateRoot = path.join(temp, 'private')
  await mkdir(root); await mkdir(privateRoot)
  configPath = path.join(temp, 'policy.json')
  await writeFile(configPath, JSON.stringify({ enabled: true, roots: [root, privateRoot], clients: [
    { id: 'reader', token, roots: [root], discloseContent: true },
    { id: 'private', token: otherToken, roots: [privateRoot] },
  ] }), { mode: 0o600 })
  policy = (await loadPolicy(configPath))!
  helper = createApp({ mcpPolicy: policy })
  await new Promise<void>((resolve, reject) => { server = helper.app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  url = `http://127.0.0.1:${address.port}/mcp`
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(clients.splice(0).map(client => client.close()))
  await helper.application.shutdown()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(temp, { recursive: true, force: true })
})
async function connect(modern = true, credential = token) {
  const client = new Client({ name: 'test', version: '1' }, modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {})
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${credential}` } } }))
  return client
}
async function project(name: string, directory = root) {
  const folder = path.join(directory, name)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run', build: 'vite build' }, dependencies: { react: '^19.0.0' } }))
  await writeFile(path.join(folder, 'README.md'), '# Demo\n\n' + '😀 context '.repeat(6000))
  return folder
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `local_repos_${name}`, arguments: args })
  if (!result.structuredContent) throw new Error(JSON.stringify(result))
  return result.structuredContent as { outcome: string; data: Record<string, any>; error?: { code: string }; revision: number }
}
async function waitOperation(client: Client, id: string) {
  for (let i = 0; i < 200; i++) {
    const result = await call(client, 'get_operation', { operationId: id })
    if (result.data.finishedAt) return result.data
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Operation timeout')
}
async function scan(client: Client, requestId = 'scan') {
  const response = await call(client, 'scan_root', { rootId: rootId(root), requestId })
  expect(response.outcome).toBe('accepted')
  const operation = await waitOperation(client, response.data.operationId)
  expect(operation.state).toBe('succeeded')
  return response.data.operationId as string
}

describe('authenticated MCP read release', () => {
  it('shares development processes across REST/MCP and stops only the observed generation after moves', async () => {
    policy.clients[0].principal.capabilities.push('development', 'network', 'project-execution')
    policy.clients[1].principal.discloseContent = true
    const directory = await project('development')
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'development', scripts: { dev: 'node dev.cjs' } }))
    await writeFile(path.join(directory, 'dev.cjs'), `console.log('😀'.repeat(6000)); console.log('token=fixture-secret'); require('node:http').createServer((req,res) => { if(req.url === '/append') console.log('later-log-entry'); res.end('ready') }).listen(Number(process.env.PORT), process.env.HOST)`)
    const client = await connect()
    await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const before = helper.application.revision
    const started = await call(client, 'start_dev_server', { projectId: id, requestId: 'start' })
    expect((await waitOperation(client, started.data.operationId)).state).toBe('succeeded')
    const current = (await call(client, 'get_dev_status', { projectId: id })).data
    expect(current).toMatchObject({ status: 'running', owned: true, processGeneration: expect.stringMatching(/^proc_/) })
    expect(helper.application.workspaceState(rootId(root))).toMatchObject({ projects: [{ dev: { status: 'running' } }] })
    expect(new URL(helper.registry.lookup(id).project.dev!.url!).href).toBe(current.url)
    expect(helper.application.revision).toBeGreaterThan(before)
    expect((await call(client, 'start_dev_server', { projectId: id, requestId: 'start' })).data.operationId).toBe(started.data.operationId)
    const retained = await call(client, 'start_dev_server', { projectId: id, requestId: 'retain' })
    await waitOperation(client, retained.data.operationId)
    expect((await call(client, 'get_dev_status', { projectId: id })).data.processGeneration).toBe(current.processGeneration)
    const privateClient = await connect(true, otherToken)
    expect((await call(privateClient, 'get_dev_status', { projectId: id })).error?.code).toBe('PROJECT_NOT_FOUND')
    expect((await call(privateClient, 'read_dev_logs', { projectId: id })).error?.code).toBe('PROJECT_NOT_FOUND')
    let page = (await call(client, 'read_dev_logs', { projectId: id, maxBytes: 512 })).data
    const firstCursor = page.nextCursor
    expect(page.truncated).toBe(true)
    expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(512)
    await fetch(new URL('/append', current.url))
    let text = page.text
    while (page.nextCursor) {
      page = (await call(client, 'read_dev_logs', { projectId: id, cursor: page.nextCursor, maxBytes: 16384 })).data
      text += page.text
    }
    expect(text).not.toContain('fixture-secret')
    expect(text).not.toContain('later-log-entry')
    expect(text).not.toContain('�')
    await helper.runtime.stop(id)
    const replacement = await helper.runtime.start(id)
    expect(replacement.status).toBe('running')
    expect((await call(client, 'read_dev_logs', { projectId: id, cursor: firstCursor })).data.resetRequired).toBe(true)
    const stale = await call(client, 'stop_dev_server', { projectId: id, processGeneration: current.processGeneration, requestId: 'stale-stop' })
    expect((await waitOperation(client, stale.data.operationId)).error.code).toBe('PROCESS_GENERATION_CHANGED')
    expect(await (await fetch(replacement.url!)).text()).toBe('ready')
    const latest = (await call(client, 'get_dev_status', { projectId: id })).data
    await rename(directory, path.join(temp, 'moved-development'))
    await scan(client, 'after-move')
    expect((await call(client, 'list_projects')).data.total).toBe(0)
    expect((await call(client, 'get_dev_status', { projectId: id })).data.processGeneration).toBe(latest.processGeneration)
    const stopped = await call(client, 'stop_dev_server', { projectId: id, processGeneration: latest.processGeneration, requestId: 'stop' })
    expect((await waitOperation(client, stopped.data.operationId)).state).toBe('succeeded')
    expect((await call(client, 'get_dev_status', { projectId: id })).data).toMatchObject({ status: 'stopped', owned: false })
    const rows = (await call(client, 'get_operation_result', { operationId: stopped.data.operationId })).data.rows.items
    expect(rows[0]).toMatchObject({ kind: 'development', action: 'stop', dev: { processGeneration: latest.processGeneration, owned: false } })
  }, 20_000)

  it('allows an exact-generation stop while the same client has a pending start', async () => {
    policy.clients[0].principal.capabilities.push('development', 'network', 'project-execution')
    const directory = await project('slow-start')
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'slow-start', scripts: { dev: 'node dev.cjs' } }))
    await writeFile(path.join(directory, 'dev.cjs'), `setTimeout(() => require('node:http').createServer((req,res) => res.end('ready')).listen(Number(process.env.PORT), process.env.HOST), 10000)`)
    const client = await connect()
    await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const started = await call(client, 'start_dev_server', { projectId: id, requestId: 'slow' })
    await vi.waitFor(() => expect(helper.runtime.devStatus(id).owned).toBe(true))
    const processGeneration = helper.runtime.devStatus(id).processGeneration
    const stopped = await call(client, 'stop_dev_server', { projectId: id, processGeneration, requestId: 'interrupt' })
    expect(stopped.outcome).toBe('accepted')
    expect((await waitOperation(client, stopped.data.operationId)).state).toBe('succeeded')
    expect((await waitOperation(client, started.data.operationId)).state).toBe('failed')
    expect(helper.runtime.devStatus(id)).toMatchObject({ status: 'stopped', owned: false, processGeneration })
  }, 15_000)

  it('requires development execution grants and rejects stale startup scripts before launching', async () => {
    policy.clients[0].principal.capabilities.push('development')
    const directory = await project('startup-policy')
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'startup-policy', scripts: { dev: 'node dev.cjs' } }))
    const client = await connect()
    await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    expect((await call(client, 'start_dev_server', { projectId: id, requestId: 'denied' })).error?.code).toBe('CAPABILITY_DISABLED')
    policy.clients[0].principal.capabilities.push('network', 'project-execution')
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'startup-policy', scripts: { dev: 'node changed.cjs' } }))
    const started = await call(client, 'start_dev_server', { projectId: id, requestId: 'changed' })
    expect((await waitOperation(client, started.data.operationId)).state).toBe('failed')
    expect(helper.runtime.devStatus(id)).toMatchObject({ status: 'error', owned: false })
    expect((await call(client, 'start_dev_server', { projectId: id, requestId: 'changed' })).data.operationId).toBe(started.data.operationId)
  })

  it('gates execution effects and shares fresh checks, progress, deduplication and report state with REST', async () => {
    policy.clients[0].principal.capabilities.push('analysis', 'preview')
    await project('analysis')
    const client = await connect()
    await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    expect((await call(client, 'run_check', { projectId: id, check: 'audit', requestId: 'denied' })).error?.code).toBe('CAPABILITY_DISABLED')
    expect((await call(client, 'capture_preview', { projectId: id, requestId: 'preview-denied' })).error?.code).toBe('CAPABILITY_DISABLED')
    const storage = await call(client, 'run_check', { projectId: id, check: 'storage', requestId: 'storage' })
    expect((await waitOperation(client, storage.data.operationId)).state).toBe('succeeded')
    expect((await call(client, 'get_operation_result', { operationId: storage.data.operationId })).data.rows.items[0]).toMatchObject({ kind: 'check', check: 'storage', report: { availability: 'available' } })
    policy.clients[0].principal.capabilities.push('network')
    expect((await call(client, 'run_check', { projectId: id, check: 'unused', requestId: 'execution-denied' })).error?.code).toBe('CAPABILITY_DISABLED')
    const report: PackageAudit = { manager: 'npm', scannedAt: new Date().toISOString(), counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, findings: [] }
    let finish!: (report: PackageAudit) => void
    const audit = vi.spyOn(auditService, 'auditProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const admitted = await call(client, 'run_check', { projectId: id, check: 'audit', requestId: 'audit' })
    await vi.waitFor(() => expect(audit).toHaveBeenCalledOnce())
    const repeated = await call(client, 'run_check', { projectId: id, check: 'audit', requestId: 'audit' })
    expect(repeated.data.operationId).toBe(admitted.data.operationId)
    const stateUrl = url.replace('/mcp', '/api/workspace-state')
    const state = await fetch(stateUrl, { method: 'POST', headers: { 'X-Local-Repos': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ rootId: rootId(root) }) }).then(response => response.json())
    expect(state.activeOperations).toMatchObject([{ kind: 'check', projectIds: [id] }])
    expect(JSON.stringify(state.activeOperations)).not.toContain('requestId')
    const rest = fetch(url.replace('/mcp', `/api/projects/${id}/audit`), { method: 'POST', headers: { 'X-Local-Repos': '1' } }).then(response => response.json())
    // Let the REST request attach to the pending shared runtime task.
    await new Promise(resolve => setTimeout(resolve, 30))
    finish(report)
    expect((await rest).audit).toEqual(report)
    expect((await waitOperation(client, admitted.data.operationId)).state).toBe('succeeded')
    expect(audit).toHaveBeenCalledOnce()
    audit.mockRejectedValue(new Error('Check failed'))
    const failed = await call(client, 'run_check', { projectId: id, check: 'audit', requestId: 'failed' })
    expect((await waitOperation(client, failed.data.operationId)).state).toBe('failed')
    const snapshot = helper.application.workspaceState(rootId(root))
    expect(snapshot.projects[0].audit).toEqual(report)
    expect(snapshot.projects[0].reportState?.audit?.validity).toBe('available')
    helper.application.index.invalidate(helper.registry.lookup(id).project, 'Dependencies changed')
    const invalidated = helper.application.workspaceState(rootId(root))
    expect(invalidated.projects[0].audit).toBeUndefined()
    expect(invalidated.projects[0].reportState?.audit).toMatchObject({ validity: 'invalidated', reason: 'Dependencies changed' })
    policy.clients[0].principal.capabilities.push('project-execution')
    const capture = vi.spyOn(helper.runtime, 'screenshot').mockImplementation(async projectId => {
      helper.registry.lookup(projectId).project.preview = { capturedAt: report.scannedAt, source: 'configured' }
      return `/api/screenshots/${projectId}.png`
    })
    const preview = await call(client, 'capture_preview', { projectId: id, source: 'website', requestId: 'preview' })
    expect((await waitOperation(client, preview.data.operationId)).state).toBe('succeeded')
    expect(capture).toHaveBeenCalledWith(id, 'website', expect.any(Function))
    expect((await call(client, 'get_operation_result', { operationId: preview.data.operationId })).data.rows.items[0]).toMatchObject({ kind: 'preview', source: 'configured', resource: `local-repos://v1/projects/${id}/preview` })
    await scan(client, 'rescan')
    expect(helper.application.workspaceState(rootId(root)).projects[0].reportState?.audit?.validity).toBe('invalidated')
    expect((await fetch(stateUrl, { method: 'POST', headers: { 'X-Local-Repos': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ rootId: rootId(root), arbitrary: true }) })).status).toBe(400)
  })

  it.each([true, false])('serves the official SDK client (modern=%s) with schemas, resources, operations and bounded context', async modern => {
    await project('alpha'); await project('beta')
    const client = await connect(modern)
    const catalog = await client.listTools()
    expect(catalog.tools.length).toBe(18)
    expect(catalog.tools.every(tool => !!tool.outputSchema && tool.inputSchema.additionalProperties === false)).toBe(true)
    expect(catalog.tools.some(tool => /run_check|start_dev|apply_/.test(tool.name))).toBe(false)
    const roots = await call(client, 'list_roots')
    expect(roots.data.items).toMatchObject([{ rootId: rootId(root), scanned: false }])
    expect(JSON.stringify(roots)).not.toContain(temp)
    const op = await scan(client)
    const retry = await call(client, 'scan_root', { rootId: rootId(root), requestId: 'scan' })
    expect(retry.data.operationId).toBe(op)
    const result = await call(client, 'get_operation_result', { operationId: op })
    expect(result.data.rows.items[0]).toMatchObject({ kind: 'scan', root: { projectCount: 2 } })
    const first = await call(client, 'list_projects', { limit: 1, filters: { dependency: { name: 'react', version: '19.*.*' } } })
    expect(first.data.total).toBe(2)
    expect(first.data.items[0].name).toBe('alpha')
    const second = await call(client, 'list_projects', { limit: 1, filters: { dependency: { name: 'react', version: '19.*.*' } }, cursor: first.data.nextCursor })
    expect(second.data.items[0].name).toBe('beta')
    const id = first.data.items[0].id
    expect((await call(client, 'get_report', { projectId: id, kind: 'audit' })).data).toMatchObject({ availability: 'missing', freshness: 'unknown', rows: { total: 0 } })
    expect((await call(client, 'get_project', { projectId: id, include: ['scripts', 'dependencies'] })).data).toMatchObject({ scripts: { total: 2 }, dependencies: { total: 1 } })
    const readme = await call(client, 'read_readme', { projectId: id, maxBytes: 101 })
    expect(Buffer.byteLength(readme.data.text)).toBeLessThanOrEqual(101)
    expect(readme.data.text).not.toContain('�')
    expect(readme.data.nextCursor).toBeTruthy()
    const resource = await client.readResource({ uri: `local-repos://v1/projects/${id}/readme` })
    expect(resource._meta?.['local-repos/pagination']).toBeTruthy()
    expect((await client.listResourceTemplates()).resourceTemplates.length).toBe(7)
    await scan(client, 'scan-again')
    expect((await call(client, 'list_projects', { limit: 1, filters: { dependency: { name: 'react', version: '19.*.*' } }, cursor: first.data.nextCursor })).error?.code).toBe('CURSOR_EXPIRED')
  })

  it('isolates roots, guessed IDs, resources and operation handles across clients', async () => {
    await project('public'); await project('secret', privateRoot)
    await helper.application.scan(privateRoot)
    const secretId = helper.application.workspaces.get(privateRoot)![0].project.id
    const client = await connect(), privateClient = await connect(true, otherToken)
    const op = await scan(client)
    expect((await call(client, 'get_project', { projectId: secretId })).error?.code).toBe('PROJECT_NOT_FOUND')
    expect((await call(client, 'scan_root', { rootId: rootId(privateRoot), requestId: 'bad' })).error?.code).toBe('ROOT_NOT_ALLOWED')
    expect((await call(privateClient, 'get_operation', { operationId: op })).error?.code).toBe('OPERATION_NOT_FOUND')
    await expect(client.readResource({ uri: `local-repos://v1/projects/${secretId}` })).rejects.toThrow()
    expect((await privateClient.listTools()).tools.some(tool => tool.name.endsWith('read_readme'))).toBe(false)
  })

  it('keeps REST checks intact and rejects hostile transport and malformed input', async () => {
    for (const headers of ([{}, { Authorization: 'Bearer wrong' }] as Record<string, string>[])) expect((await fetch(url, { method: 'POST', headers })).status).toBe(401)
    for (const headers of ([{ Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'evil.test' }] as Record<string, string>[])) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers } }, response => { response.resume(); resolve(response.statusCode) })
        req.on('error', reject); req.end()
      })
      expect(status).toBe(403)
    }
    expect((await fetch(url.replace('/mcp', '/api/scan'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root }) })).status).toBe(403)
    expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ large: 'x'.repeat(17_000) }) })).status).toBe(413)
    const client = await connect()
    const invalid = await client.callTool({ name: 'local_repos_list_projects', arguments: { arbitraryPath: root } })
    expect(invalid.isError).toBe(true)
    expect((await call(client, 'list_projects', { filters: { dependency: { name: 'react', version: 'broken!' } } })).error?.code).toBe('INVALID_ARGUMENT')
  })

  it('shares UI registrations and dated reports, excludes disappeared membership, preserves failed reports and invalidates changed metadata', async () => {
    const directory = await project('alpha')
    const client = await connect()
    await helper.application.scan(root)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const report: PackageAudit = { manager: 'npm', scannedAt: '2026-10-10T12:00:00.000Z', counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }, findings: [] }
    helper.registry.lookup(id).project.audit = report
    expect((await call(client, 'get_report', { projectId: id, kind: 'audit' })).data.availability).toBe('available')
    vi.spyOn(auditService, 'auditProject').mockRejectedValue(new Error('private environment'))
    await fetch(url.replace('/mcp', `/api/projects/${id}/audit`), { method: 'POST', headers: { 'X-Local-Repos': '1' } })
    expect((await call(client, 'get_report', { projectId: id, kind: 'audit' })).data).toMatchObject({ availability: 'available', report: { scannedAt: report.scannedAt }, lastAttempt: { status: 'failed' } })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'alpha', dependencies: { react: '^20.0.0' } }))
    await scan(client)
    expect((await call(client, 'get_report', { projectId: id, kind: 'audit' })).data.availability).toBe('invalidated')
    await rm(directory, { recursive: true })
    await scan(client, 'deleted')
    expect((await call(client, 'list_projects')).data.total).toBe(0)
    expect((await call(client, 'list_roots')).data.items[0].notObservedCount).toBe(1)
    expect(helper.registry.lookup(id).project).toBeTruthy()
  })

  it('preserves scope under overlapping roots and rejects effective workspace access from a nested grant', async () => {
    const mono = await project('mono')
    await writeFile(path.join(mono, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }))
    const child = await project('child', path.join(mono, 'packages'))
    await helper.application.scan(root)
    const childId = helper.application.workspaces.get(root)!.find(entry => entry.directory === child)!.project.id
    await helper.application.scan(child)
    const entry = helper.registry.lookup(childId)
    expect(entry.workspaceDirectory).toBe(mono)
    const parentId = helper.application.workspaces.get(root)!.find(entry => entry.directory === mono)!.project.id
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    helper.application.operations.admit('scope-fixture', 'work', 'check', {}, [parentId], async () => { await pending; return [] })
    try {
      expect(helper.application.workspaceState(rootId(child)).activeOperations).toMatchObject([{ projectIds: [childId] }])
    } finally { release() }
    const nested = { ...policy.clients[0].principal, roots: [{ id: rootId(child), directory: child, name: 'child' }] }
    await expect(helper.application.index.checkedEntry(nested, childId, true)).rejects.toMatchObject({ code: 'ROOT_NOT_ALLOWED' })
    expect(helper.application.index.detail(nested, childId).relatedProjectIds).toEqual([childId])
    expect(helper.application.index.detail(nested, childId).visualGroupId).toBeUndefined()
  })

  it('does not print credentials or protocol diagnostics to stdout when the bridge cannot authenticate', async () => {
    const filename = path.join(temp, 'bad-client.json')
    await writeFile(filename, JSON.stringify({ url, token: 'z'.repeat(48) }), { mode: 0o600 })
    const error = await exec(process.execPath, ['--import', 'tsx', 'server/mcp/stdio.ts'], { cwd: process.cwd(), env: { ...process.env, LOCAL_REPOS_MCP_CLIENT_CONFIG: filename }, timeout: 15_000 }).then(() => undefined, error => error as { stdout: string; stderr: string })
    expect(error?.stdout).toBe('')
    expect(error?.stderr).toContain('Cannot connect to the MCP helper')
    expect(error?.stderr).not.toContain('z'.repeat(48))
  })

  it('rejects replaced configured root symlinks', async () => {
    const client = await connect()
    await rename(root, `${root}-old`)
    await symlink(privateRoot, root)
    const result = await call(client, 'scan_root', { rootId: rootId(root), requestId: 'replaced' })
    expect((await waitOperation(client, result.data.operationId)).error.code).toBe('PATH_CHANGED')
    expect(helper.application.roots.size).toBe(0)
  })

  it('queries Git locally with exact authors, moved-ref cursors and per-repository day results', async () => {
    const directory = await project('git')
    const run = (args: string[]) => exec('git', args, { cwd: directory, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-10T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T10:00:00Z' } })
    await run(['init', '-q']); await run(['config', 'user.name', 'Fixture']); await run(['config', 'user.email', 'fixture@example.test'])
    await run(['add', '.']); await run(['commit', '-qm', 'first'])
    const client = await connect(); await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const history = await call(client, 'get_git_history', { projectId: id, authorEmail: 'fixture@example.test' })
    expect(history.data.rows.total).toBe(1)
    expect((await call(client, 'get_git_history', { projectId: id, authorEmail: 'example.test' })).data.rows.total).toBe(0)
    expect((await call(client, 'get_git_history', { projectId: id, branch: 'HEAD~1' })).error?.code).toBe('INVALID_ARGUMENT')
    const day = await call(client, 'get_daily_summary', { rootId: rootId(root), from: '2026-10-09T22:00:00.000Z', to: '2026-10-10T22:00:00.000Z', requestId: 'day' })
    await waitOperation(client, day.data.operationId)
    const rows = (await call(client, 'get_operation_result', { operationId: day.data.operationId })).data.rows.items
    expect(rows).toMatchObject([{ kind: 'repository', commits: 1 }, { kind: 'commit', message: 'first' }])
    expect((await call(client, 'get_push_status', { projectId: id })).data).toMatchObject({ available: true, hasOrigin: false, originRefsKnown: false })
    expect((await call(client, 'scan_root', { rootId: rootId(root), requestId: 'day' })).error?.code).toBe('REQUEST_ID_CONFLICT')
  })

  it('preserves partial reports, null scores, skipped declarations, suppressions and bounded pages', async () => {
    await project('reports')
    const client = await connect(); await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const p = helper.registry.lookup(id).project
    p.storage = { measuredAt: p.scannedAt, totalBytes: 10, nodeModulesBytes: 0, hasNodeModules: false, partial: true }
    p.reactDoctor = { scannedAt: p.scannedAt, version: '1', score: null, label: 'Unknown', findings: [], warning: 'Scoring unavailable' }
    p.outdated = { manager: 'npm', scannedAt: p.scannedAt, findings: [], score: 0, level: 'current', skipped: [{ name: 'git-package', reason: 'Not a semver declaration' }] }
    p.audit = { manager: 'npm', scannedAt: p.scannedAt, counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, originalCounts: { info: 0, low: 0, moderate: 0, high: 0, critical: 1 }, findings: Array.from({ length: 50 }, (_, i) => ({ name: `pkg-${i}`, title: 'Untrusted finding', severity: 'critical', url: 'https://user:password@example.test/advisory?token=secret', suppression: { source: '.trivyignore', ids: ['CVE-fixture'] } })) }
    expect((await call(client, 'get_report', { projectId: id, kind: 'storage' })).data.completeness).toBe('partial')
    expect((await call(client, 'get_report', { projectId: id, kind: 'storage', limit: 1 })).error?.code).toBe('INVALID_ARGUMENT')
    expect((await call(client, 'get_report', { projectId: id, kind: 'reactDoctor' })).data.report.score).toBeNull()
    expect((await call(client, 'get_report', { projectId: id, kind: 'outdated' })).data.rows.items[0].rowKind).toBe('skipped')
    const first = await call(client, 'get_report', { projectId: id, kind: 'audit', limit: 3 })
    expect(first.data.rows.total).toBe(50)
    expect(first.data.rows.items.length).toBe(3)
    expect(JSON.stringify(first)).not.toMatch(/password|token=secret/)
    expect(first.data.report.originalCounts.critical).toBe(1)
    const next = await call(client, 'get_report', { projectId: id, kind: 'audit', limit: 3, cursor: first.data.rows.nextCursor })
    expect(next.data.rows.items[0].name).toBe('pkg-3')
    expect((await call(client, 'list_findings')).data.rows.total).toBe(0)
    p.hasPackageJson = false
    expect((await call(client, 'get_report', { projectId: id, kind: 'audit' })).data.availability).toBe('available')
    expect((await call(client, 'get_report', { projectId: id, kind: 'unused' })).data.availability).toBe('unsupported')
  })

  it('rejects moved Git refs between commit pages and binds README cursors to content', async () => {
    const directory = await project('history')
    const run = (args: string[]) => exec('git', args, { cwd: directory })
    await run(['init', '-q']); await run(['config', 'user.name', 'Fixture']); await run(['config', 'user.email', 'fixture@example.test'])
    for (let i = 0; i < 26; i++) await run(['commit', '--allow-empty', '-qm', `commit-${i}`])
    const client = await connect(); await scan(client)
    const id = (await call(client, 'list_projects')).data.items[0].id
    const first = await call(client, 'get_git_history', { projectId: id })
    expect(first.data.rows.items.length).toBe(25)
    await run(['commit', '--allow-empty', '-qm', 'new tip'])
    expect((await call(client, 'get_git_history', { projectId: id, cursor: first.data.rows.nextCursor })).error?.code).toBe('CURSOR_EXPIRED')
    const readme = await call(client, 'read_readme', { projectId: id, maxBytes: 100 })
    await writeFile(path.join(directory, 'README.md'), 'Changed content')
    await scan(client, 'changed-readme')
    expect((await call(client, 'read_readme', { projectId: id, cursor: readme.data.nextCursor })).error?.code).toBe('CURSOR_EXPIRED')
  })

  it('shares discovery and maintenance guards, rejects scope changes while busy, and resets boot state', async () => {
    const directory = await project('guard')
    await helper.application.scan(root)
    const id = helper.application.workspaces.get(root)![0].project.id
    const release = helper.runtime.reserveMetadataScan()
    await expect(helper.runtime.deleteNodeModules(id, true)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.updatePackages(id, 'patch')).rejects.toMatchObject({ status: 409 })
    release()
    const releaseAgain = helper.runtime.reserveMetadataScan()
    await expect(helper.application.scan(root)).rejects.toMatchObject({ status: 409 })
    releaseAgain()
    const before = helper.registry.lookup(id)
    const replacement = { ...before, project: { ...before.project }, workspaceDirectory: root }
    expect(() => helper.registry.register([replacement], () => true)).toThrow('SCOPE_CONFLICT')
    expect(helper.registry.lookup(id).workspaceDirectory).toBeUndefined()
    const fresh = createApp()
    try {
      expect(fresh.application.helperInstanceId).not.toBe(helper.application.helperInstanceId)
      expect(fresh.application.roots.size).toBe(0)
      await fresh.application.scan(root)
      expect(fresh.registry.lookup(id).directory).toBe(directory)
      expect(fresh.registry.lookup(id).project.audit).toBeUndefined()
    } finally { await fresh.application.shutdown() }
  })

  it.each([true, false])('bridges stdio (modern=%s) through the authenticated existing helper', async modern => {
    const filename = path.join(temp, 'client.json')
    await writeFile(filename, JSON.stringify({ url, token }), { mode: 0o600 })
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/mcp/stdio.ts'], cwd: process.cwd(), env: { ...process.env as Record<string, string>, LOCAL_REPOS_MCP_CLIENT_CONFIG: filename }, stderr: 'pipe' })
    const client = new Client({ name: 'stdio-test', version: '1' }, modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {})
    clients.push(client)
    let diagnostics = ''
    transport.stderr?.on('data', chunk => { diagnostics += String(chunk) })
    await client.connect(transport)
    const info = await call(client, 'get_server_info')
    expect(info.data.helperInstanceId).toBe(helper.application.helperInstanceId)
    expect((await client.listTools()).tools.length).toBe(18)
    expect(diagnostics).toBe('')
  })
})

describe('configuration and operation retention', () => {
  it('rejects unsafe config permissions and configuration within a scan root', async () => {
    await chmod(configPath, 0o644)
    await expect(loadPolicy(configPath)).rejects.toThrow('owner-only')
    await chmod(configPath, 0o600)
    const nested = path.join(root, 'config.json')
    const { readFile } = await import('node:fs/promises')
    await writeFile(nested, await readFile(configPath), { mode: 0o600 })
    await expect(loadPolicy(nested)).rejects.toThrow('outside')
  })
  it('reserves request IDs before awaits, cancels queued work and retains expired admission tombstones', async () => {
    let now = Date.now()
    const operations = new Operations('boot-test', () => now)
    const run = vi.fn(async () => [{ value: 1 }])
    const first = operations.admit('a', 'one', 'scan', { root: 1 }, [], run)
    expect(operations.admit('a', 'one', 'scan', { root: 1 }, [], run).operationId).toBe(first.operationId)
    expect(() => operations.admit('a', 'one', 'scan', { root: 2 }, [], run)).toThrow('different arguments')
    operations.cancel('a', first.operationId)
    await operations.shutdown()
    expect(run).not.toHaveBeenCalled()
    expect(operations.get('a', first.operationId).state).toBe('cancelled')
    now += 31 * 60_000
    expect(() => operations.admit('a', 'one', 'scan', { root: 1 }, [], run)).toThrow('expired')
  })
  it('caps queued items and retains successful current work after an active cancellation', async () => {
    const operations = new Operations('boot-test')
    let finish!: (value: unknown[]) => void
    const first = operations.admit('a', 'one', 'daily-summary', {}, Array.from({ length: 100 }, (_, i) => String(i)), () => new Promise(resolve => { finish = resolve }))
    expect(() => operations.admit('b', 'two', 'scan', {}, [], async () => [])).toThrow('limit')
    await Promise.resolve()
    operations.cancel('a', first.operationId)
    finish([{ kind: 'repository', available: true }])
    await operations.shutdown()
    expect(operations.get('a', first.operationId)).toMatchObject({ state: 'succeeded', cancelRequested: true, resultAvailable: true })
  })

})
