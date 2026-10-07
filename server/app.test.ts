import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { request, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { devCommand } from './runtime'
import type { RepoProject } from '../src/types'

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
