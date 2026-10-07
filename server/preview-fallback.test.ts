import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { createApp } from './app'
import * as renderer from './preview-renderer'
import * as sources from './preview-sources'
import type { RepoProject } from '../src/types'

let directory: string
let helper: ReturnType<typeof createApp>
let server: Server
let address: string
let browser: Browser
const png = Buffer.from('captured-preview-fixture')

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-preview-fallback-'))
  helper = createApp()
  await new Promise<void>((resolve, reject) => {
    server = helper.app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve())
  })
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('Fixture address unavailable')
  address = `http://127.0.0.1:${bound.port}`
  browser = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Browser
  vi.spyOn(chromium, 'launch').mockResolvedValue(browser)
  vi.spyOn(renderer, 'capturePage').mockResolvedValue(png)
  vi.spyOn(sources, 'resolveGithubHomepage').mockResolvedValue(undefined)
})

afterEach(async () => {
  await helper.runtime.shutdown()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function post(endpoint: string, body: unknown = {}) {
  return fetch(`${address}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Repos': '1' }, body: JSON.stringify(body) })
}

async function project(fields: Record<string, unknown> = {}) {
  const folder = path.join(directory, 'project')
  await mkdir(folder)
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'fixture', ...fields }))
  const result = await (await post('/api/scan', { path: directory })).json()
  return result.projects[0] as RepoProject
}

describe('preview capture fallbacks', () => {
  it('captures a package homepage without a dev script and returns its source', async () => {
    const repo = await project({ homepage: 'https://example.com/app/#/home' })
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    const captured = await response.json()
    expect(captured).toMatchObject({ preview: { url: 'https://example.com/app/#/home', source: 'package' }, dev: { status: 'stopped' } })
    expect(renderer.capturePage).toHaveBeenCalledWith(browser, 'https://example.com/app/#/home')
    expect(sources.resolveGithubHomepage).not.toHaveBeenCalled()
    const image = await fetch(`${address}${captured.screenshot}`)
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png)
  })

  it('prefers an explicit preview route and lets website mode bypass a broken local script', async () => {
    const repo = await project({ scripts: { dev: 'node missing.cjs' }, homepage: 'https://example.com/', localRepos: { previewUrl: 'https://example.com/demo/#/board' } })
    const start = vi.spyOn(helper.runtime, 'start')
    const response = await post(`/api/projects/${repo.id}/screenshot`, { source: 'website' })
    expect(response.status).toBe(200)
    expect((await response.json()).preview).toMatchObject({ source: 'configured', url: 'https://example.com/demo/#/board' })
    expect(start).not.toHaveBeenCalled()
  })

  it('falls back from a crashed server to the package homepage', async () => {
    const repo = await project({ scripts: { dev: 'node missing.cjs' }, homepage: 'https://example.com/live' })
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect((await response.json()).preview.source).toBe('package')
    expect((await helper.runtime.status(repo.id)).status).toBe('error')
  }, 15_000)

  it('rejects a blank local render, stops its temporary server, then captures the website', async () => {
    const repo = await project({ scripts: { dev: 'node dev.cjs' }, homepage: 'https://example.com/deployed' })
    await writeFile(path.join(directory, 'project/dev.cjs'), "require('node:http').createServer((req,res)=>res.end('<div id=\"root\"></div>')).listen(Number(process.env.PORT),process.env.HOST)")
    vi.mocked(renderer.capturePage).mockRejectedValueOnce(new Error('No visible content rendered. JavaScript: initialization failed.'))
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    const captured = await response.json()
    expect(captured).toMatchObject({ preview: { url: 'https://example.com/deployed', source: 'package' }, dev: { status: 'stopped' } })
    const localUrl = vi.mocked(renderer.capturePage).mock.calls[0][1]
    expect(localUrl).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(renderer.capturePage).toHaveBeenNthCalledWith(2, browser, 'https://example.com/deployed')
    await expect(fetch(localUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  }, 15_000)

  it('resolves the configured GitHub website rather than capturing the repository page', async () => {
    const repo = await project()
    helper.registry.lookup(repo.id).project.git = { origin: 'https://github.com/example/project' }
    vi.mocked(sources.resolveGithubHomepage).mockResolvedValue({ url: 'https://project.example/app/', source: 'github' })
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect(sources.resolveGithubHomepage).toHaveBeenCalledWith('https://github.com/example/project')
    expect(renderer.capturePage).toHaveBeenCalledWith(browser, 'https://project.example/app/')
    expect((await response.json()).preview.source).toBe('github')
  })

  it('keeps the existing image if every new candidate fails and local mode avoids remote lookups', async () => {
    const repo = await project({ homepage: 'https://example.com' })
    const first = await (await post(`/api/projects/${repo.id}/screenshot`)).json()
    const localOnly = await post(`/api/projects/${repo.id}/screenshot`, { source: 'local' })
    expect(localOnly.status).toBe(422)
    expect(sources.resolveGithubHomepage).not.toHaveBeenCalled()
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('No visible content rendered.'))
    const failed = await post(`/api/projects/${repo.id}/screenshot`)
    expect(failed.status).toBe(422)
    expect((await failed.json()).error).toContain('No visible content rendered')
    expect(helper.registry.lookup(repo.id).project.screenshot).toBe(first.screenshot)
    expect(helper.registry.lookup(repo.id).project.preview).toEqual(first.preview)
  })
})
