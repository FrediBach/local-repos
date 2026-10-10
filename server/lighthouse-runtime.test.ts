import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LighthouseReport, RepoProject } from '../src/types'
import { createApp } from './app'
import * as lighthouse from './lighthouse'
import * as packageUpdate from './package-update'

let helper: ReturnType<typeof createApp>
let server: Server
let directory: string
let address: string
let browser: Browser
const url = 'https://frontend.example/'
const report: LighthouseReport = {
  scannedAt: '2026-10-10T12:00:00Z', version: '12.8.2', requestedUrl: url, url, formFactor: 'desktop',
  categories: [{ id: 'performance', title: 'Performance', score: 92 }, { id: 'accessibility', title: 'Accessibility', score: 96 }, { id: 'best-practices', title: 'Best practices', score: 100 }, { id: 'seo', title: 'SEO', score: 100 }], audits: [], warnings: [],
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-lighthouse-runtime-'))
  helper = createApp()
  server = await new Promise<Server>(resolve => {
    const listener = helper.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('No server address')
  address = `http://127.0.0.1:${bound.port}`
  browser = { close: vi.fn(async () => {}) } as unknown as Browser
  vi.spyOn(chromium, 'launch').mockResolvedValue(browser)
  vi.spyOn(lighthouse, 'validateLighthousePage').mockResolvedValue()
  vi.spyOn(lighthouse, 'lighthouseProject').mockResolvedValue(report)
})
afterEach(async () => {
  await helper.runtime.shutdown()
  vi.restoreAllMocks()
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await rm(directory, { recursive: true, force: true })
})
async function post(endpoint: string, body: unknown = {}, extraHeaders: Record<string, string> = {}) {
  return fetch(`${address}${endpoint}`, { method: 'POST', headers: { 'X-Local-Repos': '1', 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) })
}
async function project(manifest: object = { name: 'fixture', localRepos: { previewUrl: url } }): Promise<RepoProject> {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest))
  return (await (await post('/api/scan', { path: directory })).json()).projects[0]
}

describe('Lighthouse helper integration', () => {
  it('uses registered frontend targets, protects its API, retains reports across rescans and failures, and allows retries', async () => {
    const fixture = await project()
    const endpoint = `/api/projects/${fixture.id}/lighthouse`
    expect((await post('/api/projects/unknown/lighthouse')).status).toBe(404)
    expect((await post(endpoint, {}, { Origin: 'https://untrusted.example' })).status).toBe(403)
    expect((await fetch(`${address}${endpoint}`, { method: 'POST' })).status).toBe(403)
    const response = await post(endpoint, { url: 'file:///tmp/ignored', command: 'ignored' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ lighthouse: report, reportState: { lighthouse: { validity: 'available' } } })
    expect(lighthouse.validateLighthousePage).toHaveBeenCalledWith(browser, url)
    expect(lighthouse.lighthouseProject).toHaveBeenCalledWith(url, expect.any(Number), expect.any(AbortSignal), undefined, expect.any(Function))
    expect(browser.close).toHaveBeenCalledOnce()
    expect((await (await post('/api/scan', { path: directory })).json()).projects[0].lighthouse).toEqual(report)
    vi.mocked(lighthouse.lighthouseProject).mockRejectedValueOnce(new Error('Scan failed'))
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toThrow('Scan failed')
    expect(helper.registry.lookup(fixture.id).project.lighthouse).toEqual(report)
    expect(await helper.runtime.lighthouse(fixture.id)).toEqual(report)
    await rename(path.join(directory, 'package.json'), path.join(directory, 'moved.json'))
    expect((await post(endpoint)).status).toBe(400)
  })

  it('refuses ineligible packages and changed frontend commands before starting a browser', async () => {
    const fixture = await project({ name: 'fixture', scripts: { dev: 'node api.js' }, dependencies: { react: '1' } })
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toThrow('runnable frontend')
    await project({ name: 'fixture', scripts: { dev: 'vite' } })
    await writeFile(path.join(directory, 'package.json'), '{"scripts":{"dev":"vite --host"}}')
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toMatchObject({ status: 409 })
    expect(chromium.launch).not.toHaveBeenCalled()
  })

  it('reserves a scan before asynchronous validation, deduplicates it and blocks sibling maintenance and previews', async () => {
    await mkdir(path.join(directory, 'packages/member'), { recursive: true })
    await writeFile(path.join(directory, 'package.json'), '{"name":"root","workspaces":["packages/*"]}')
    await writeFile(path.join(directory, 'packages/member/package.json'), JSON.stringify({ name: 'member', localRepos: { previewUrl: url } }))
    const projects = (await (await post('/api/scan', { path: directory })).json()).projects as RepoProject[]
    const root = projects.find(project => project.name === 'root')!
    const member = projects.find(project => project.name === 'member')!
    let finish!: (value: LighthouseReport) => void
    vi.mocked(lighthouse.lighthouseProject).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = helper.runtime.lighthouse(member.id)
    const second = helper.runtime.lighthouse(member.id)
    await expect(helper.runtime.updatePackages(root.id, 'patch')).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.deleteNodeModules(root.id, true)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.screenshot(root.id)).rejects.toMatchObject({ status: 409 })
    await expect(helper.runtime.lighthouse(root.id)).rejects.toMatchObject({ status: 409 })
    await vi.waitFor(() => expect(lighthouse.lighthouseProject).toHaveBeenCalledOnce())
    finish(report)
    expect(await first).toEqual(report)
    expect(await second).toEqual(report)
    vi.spyOn(packageUpdate, 'updateProject').mockRejectedValueOnce(new Error('Partial installation'))
    await expect(helper.runtime.updatePackages(root.id, 'patch')).rejects.toThrow('Partial installation')
    expect(helper.registry.lookup(member.id).project.lighthouse).toBeUndefined()
  })

  it('blocks Lighthouse while maintenance or capture is pending', async () => {
    const fixture = await project()
    let finish!: () => void
    const update = vi.spyOn(packageUpdate, 'updateProject').mockImplementation(() => new Promise(resolve => { finish = () => resolve({ level: 'patch', packages: [], skipped: [], updatedAt: new Date().toISOString() }) }))
    const updating = helper.runtime.updatePackages(fixture.id, 'patch')
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toMatchObject({ status: 409 })
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    finish()
    await updating
    vi.mocked(chromium.launch).mockRejectedValueOnce(new Error('No browser'))
    const capture = helper.runtime.screenshot(fixture.id).catch(error => error)
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toMatchObject({ status: 409 })
    await capture
  })

  it('aborts scans and waits for their browser cleanup on shutdown without replacing saved reports', async () => {
    const fixture = await project()
    helper.registry.lookup(fixture.id).project.lighthouse = report
    let aborted = false
    vi.mocked(lighthouse.lighthouseProject).mockImplementation((_url, _port, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')) }, { once: true })
    }))
    const scanning = helper.runtime.lighthouse(fixture.id).catch(error => error)
    await vi.waitFor(() => expect(lighthouse.lighthouseProject).toHaveBeenCalledOnce())
    await helper.runtime.shutdown()
    expect(aborted).toBe(true)
    expect(await scanning).toBeInstanceOf(Error)
    expect(browser.close).toHaveBeenCalled()
    expect(helper.registry.lookup(fixture.id).project.lighthouse).toEqual(report)
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toMatchObject({ status: 503 })
  })

  it.each([false, true])('stops temporary dev servers but preserves explicitly running servers (persistent=%s)', async persistent => {
    await writeFile(path.join(directory, 'server.mjs'), "import http from 'node:http'; http.createServer((_request, response) => response.end('<html>App</html>')).listen(Number(process.env.PORT), '127.0.0.1')")
    const fixture = await project({ name: 'fixture', scripts: { dev: 'node server.mjs' } })
    // This test isolates runtime ownership; eligibility is covered separately.
    vi.spyOn(lighthouse, 'validateLighthouseProject').mockResolvedValue(undefined)
    if (persistent) expect((await helper.runtime.start(fixture.id)).status).toBe('running')
    await helper.runtime.lighthouse(fixture.id)
    expect((await helper.runtime.status(fixture.id)).status).toBe(persistent ? 'running' : 'stopped')
  })

  it('cleans up its temporary server when Chromium is missing', async () => {
    await writeFile(path.join(directory, 'server.mjs'), "import http from 'node:http'; http.createServer((_request, response) => response.end('App')).listen(Number(process.env.PORT), '127.0.0.1')")
    const fixture = await project({ name: 'fixture', scripts: { dev: 'node server.mjs' } })
    vi.spyOn(lighthouse, 'validateLighthouseProject').mockResolvedValue(undefined)
    vi.mocked(chromium.launch).mockRejectedValueOnce(new Error('No executable'))
    await expect(helper.runtime.lighthouse(fixture.id)).rejects.toThrow('npx playwright install chromium')
    expect((await helper.runtime.status(fixture.id)).status).toBe('stopped')
  })
})
