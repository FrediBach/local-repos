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
  it.each([true, false])('serves the official SDK client (modern=%s) with schemas, resources, operations and bounded context', async modern => {
    await project('alpha'); await project('beta')
    const client = await connect(modern)
    const catalog = await client.listTools()
    expect(catalog.tools.length).toBe(16)
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
    expect((await client.listTools()).tools.length).toBe(16)
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
