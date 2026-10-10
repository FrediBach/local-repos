import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { PNG } from 'pngjs'
import { createApp } from './app'
import * as renderer from './preview-renderer'
import * as sources from './preview-sources'
import * as assets from './preview-assets'
import * as assetRenderer from './preview-asset-renderer'
import type { RepoProject } from '../src/types'

let directory: string
let helper: ReturnType<typeof createApp>
let server: Server
let address: string
let browser: Browser
const png = Buffer.from('captured-preview-fixture')

beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-preview-fallback-')))
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
  vi.spyOn(assets, 'discoverPreviewAssets').mockResolvedValue([])
  vi.spyOn(assetRenderer, 'renderPreviewAsset').mockResolvedValue(png)
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
    expect(renderer.capturePage).toHaveBeenCalledWith(browser, 'https://example.com/app/#/home', expect.any(Function))
    expect(sources.resolveGithubHomepage).not.toHaveBeenCalled()
    expect(assets.discoverPreviewAssets).not.toHaveBeenCalled()
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
    vi.mocked(assets.discoverPreviewAssets).mockResolvedValue([{ kind: 'og-image', source: 'local', url: 'http://localhost/', assetUrl: 'http://localhost/social.png', load: async () => ({ bytes: png, mimeType: 'image/png' }) }])
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    const captured = await response.json()
    expect(captured).toMatchObject({ preview: { url: 'https://example.com/deployed', source: 'package' }, dev: { status: 'stopped' } })
    const localUrl = vi.mocked(renderer.capturePage).mock.calls[0][1]
    expect(localUrl).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(renderer.capturePage).toHaveBeenNthCalledWith(2, browser, 'https://example.com/deployed', expect.any(Function))
    expect(assetRenderer.renderPreviewAsset).not.toHaveBeenCalled()
    await expect(fetch(localUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  }, 15_000)

  it('resolves the configured GitHub website rather than capturing the repository page', async () => {
    const repo = await project()
    helper.registry.lookup(repo.id).project.git = { origin: 'https://github.com/example/project' }
    vi.mocked(sources.resolveGithubHomepage).mockResolvedValue({ url: 'https://project.example/app/', source: 'github' })
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect(sources.resolveGithubHomepage).toHaveBeenCalledWith('https://github.com/example/project')
    expect(renderer.capturePage).toHaveBeenCalledWith(browser, 'https://project.example/app/', expect.any(Function))
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

  it('tries every rendered website before using an Open Graph image and returns durable PNG provenance', async () => {
    const repo = await project({ homepage: 'https://example.com/live', localRepos: { previewUrl: 'https://example.com/demo' } })
    vi.mocked(sources.resolveGithubHomepage).mockResolvedValue({ url: 'https://project.example/', source: 'github' })
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('The app failed to render.'))
    const load = vi.fn().mockResolvedValue({ bytes: Buffer.from('jpeg-fixture'), mimeType: 'image/jpeg' })
    vi.mocked(assets.discoverPreviewAssets).mockResolvedValue([{ kind: 'og-image', source: 'configured', url: 'https://example.com/demo', assetUrl: 'https://example.com/social.jpg', load }])

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(renderer.capturePage).toHaveBeenCalledTimes(3)
    expect(vi.mocked(renderer.capturePage).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(assets.discoverPreviewAssets).mock.invocationCallOrder[0])
    expect(assets.discoverPreviewAssets).toHaveBeenCalledWith(browser, path.join(directory, 'project'), [
      { source: 'configured', url: 'https://example.com/demo' },
      { source: 'package', url: 'https://example.com/live' },
      { source: 'github', url: 'https://project.example/' },
    ])
    expect(result.preview).toMatchObject({ kind: 'og-image', source: 'configured', url: 'https://example.com/demo', assetUrl: 'https://example.com/social.jpg' })
    expect(assetRenderer.renderPreviewAsset).toHaveBeenCalledWith(browser, await load.mock.results[0].value, 'og-image')
    const image = await fetch(`${address}${result.screenshot}`)
    expect(image.headers.get('content-type')).toContain('image/png')
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png)
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('continues past a corrupt social image and missing logo to a usable favicon', async () => {
    const repo = await project({ homepage: 'https://example.com/' })
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('Blank page'))
    const social = { bytes: Buffer.from('corrupt'), mimeType: 'image/png' }
    const icon = { bytes: Buffer.from('icon'), mimeType: 'image/x-icon' }
    const candidates: assets.PreviewAssetCandidate[] = [
      { kind: 'og-image', source: 'package', url: repo.homepage, assetUrl: 'https://example.com/og.png', load: vi.fn().mockResolvedValue(social) },
      { kind: 'logo', source: 'package', url: repo.homepage, assetUrl: 'https://example.com/logo.svg', load: vi.fn().mockResolvedValue(undefined) },
      { kind: 'favicon', source: 'package', url: repo.homepage, assetUrl: 'https://example.com/favicon.ico', load: vi.fn().mockResolvedValue(icon) },
    ]
    vi.mocked(assets.discoverPreviewAssets).mockResolvedValue(candidates)
    vi.mocked(assetRenderer.renderPreviewAsset).mockRejectedValueOnce(new Error('Invalid image'))

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect((await response.json()).preview).toMatchObject({ kind: 'favicon', assetUrl: 'https://example.com/favicon.ico' })
    expect(assetRenderer.renderPreviewAsset).toHaveBeenCalledTimes(2)
    expect(assetRenderer.renderPreviewAsset).toHaveBeenLastCalledWith(browser, icon, 'favicon')
    for (const candidate of candidates) expect(candidate.load).toHaveBeenCalledOnce()
  })

  it('uses repository branding without a development script or project URL', async () => {
    const repo = await project()
    vi.mocked(assets.discoverPreviewAssets).mockResolvedValue([{ kind: 'logo', source: 'repository', assetPath: 'public/logo.svg', load: vi.fn().mockResolvedValue({ bytes: Buffer.from('svg'), mimeType: 'image/svg+xml' }) }])

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect((await response.json()).preview).toMatchObject({ source: 'repository', kind: 'logo', assetPath: 'public/logo.svg' })
    expect(renderer.capturePage).not.toHaveBeenCalled()
    expect(assets.discoverPreviewAssets).toHaveBeenCalledWith(browser, path.join(directory, 'project'), [])
  })

  it('keeps website fallback out of the repository and local fallback out of website discovery', async () => {
    const repo = await project({ homepage: 'https://example.com/' })
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('Page unavailable'))
    expect((await post(`/api/projects/${repo.id}/screenshot`, { source: 'website' })).status).toBe(422)
    expect(assets.discoverPreviewAssets).toHaveBeenLastCalledWith(browser, undefined, [{ source: 'package', url: 'https://example.com/' }])
    vi.mocked(sources.resolveGithubHomepage).mockClear()
    expect((await post(`/api/projects/${repo.id}/screenshot`, { source: 'local' })).status).toBe(422)
    expect(assets.discoverPreviewAssets).toHaveBeenLastCalledWith(browser, path.join(directory, 'project'), [])
    expect(sources.resolveGithubHomepage).not.toHaveBeenCalled()
  })

  it('preserves the previous PNG and provenance when all asset fallbacks are unusable', async () => {
    const repo = await project({ homepage: 'https://example.com/' })
    const first = await (await post(`/api/projects/${repo.id}/screenshot`)).json()
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('Blank page'))
    vi.mocked(assets.discoverPreviewAssets).mockResolvedValue([{ kind: 'logo', source: 'repository', assetPath: 'logo.svg', load: vi.fn().mockResolvedValue({ bytes: Buffer.from('invalid'), mimeType: 'image/svg+xml' }) }])
    vi.mocked(assetRenderer.renderPreviewAsset).mockRejectedValue(new Error('Image could not be decoded'))

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain('No usable Open Graph image, logo, or favicon')
    expect(helper.registry.lookup(repo.id).project.preview).toEqual(first.preview)
    expect(helper.registry.lookup(repo.id).project.screenshot).toBe(first.screenshot)
    const image = await fetch(`${address}${first.screenshot}`)
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png)
  })

  it('stops a failed local capture server before looking for static repository assets', async () => {
    const repo = await project({ scripts: { dev: 'node dev.cjs' } })
    await writeFile(path.join(directory, 'project/dev.cjs'), "require('node:http').createServer((req,res)=>res.end('<div id=\"root\"></div>')).listen(Number(process.env.PORT),process.env.HOST)")
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('Blank local app'))
    vi.mocked(assets.discoverPreviewAssets).mockImplementation(async (_browser, repository) => {
      if (!repository) {
        expect((await helper.runtime.status(repo.id)).status).toBe('running')
        return []
      }
      expect((await helper.runtime.status(repo.id)).status).toBe('stopped')
      return [{ kind: 'favicon', source: 'repository', assetPath: 'public/favicon.ico', load: async () => ({ bytes: Buffer.from('icon'), mimeType: 'image/x-icon' }) }]
    })
    const start = vi.spyOn(helper.runtime, 'start')
    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect((await response.json()).dev.status).toBe('stopped')
    expect(start).toHaveBeenCalledOnce()
    expect(assets.discoverPreviewAssets).toHaveBeenCalledWith(browser, path.join(directory, 'project'), [])
    const localUrl = vi.mocked(renderer.capturePage).mock.calls[0][1]
    await expect(fetch(localUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  }, 15_000)

  it('retains generated local metadata assets before stopping the temporary server', async () => {
    const repo = await project({ scripts: { dev: 'node dev.cjs' }, homepage: 'https://example.com/' })
    await writeFile(path.join(directory, 'project/dev.cjs'), "require('node:http').createServer((req,res)=>res.end('<div id=\"root\"></div>')).listen(Number(process.env.PORT),process.env.HOST)")
    vi.mocked(renderer.capturePage).mockRejectedValue(new Error('Page failed to render'))
    const load = vi.fn(async () => {
      expect((await helper.runtime.status(repo.id)).status).toBe('running')
      return { bytes: png, mimeType: 'image/png' }
    })
    vi.mocked(assets.discoverPreviewAssets).mockImplementation(async (_browser, repository, targets) => {
      if (!repository) return [{ kind: 'og-image', source: 'local', url: targets[0].url, assetUrl: `${targets[0].url}/generated-image`, load }]
      expect((await helper.runtime.status(repo.id)).status).toBe('stopped')
      return [{ kind: 'logo', source: 'repository', assetPath: 'public/logo.png', load: async () => ({ bytes: png, mimeType: 'image/png' }) }]
    })
    vi.mocked(assetRenderer.renderPreviewAsset).mockImplementation(async () => {
      expect((await helper.runtime.status(repo.id)).status).toBe('stopped')
      return png
    })

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    expect((await response.json()).preview).toMatchObject({ kind: 'og-image', source: 'local', assetUrl: expect.stringContaining('/generated-image') })
    expect(load).toHaveBeenCalledOnce()
    expect(renderer.capturePage).toHaveBeenCalledTimes(2)
    expect(assetRenderer.renderPreviewAsset).toHaveBeenCalledOnce()
  }, 15_000)

  it.skipIf(!existsSync(chromium.executablePath()))('serves a real repository SVG as a cached PNG through the helper API', async () => {
    const repo = await project()
    await mkdir(path.join(directory, 'project/public'))
    await writeFile(path.join(directory, 'project/public/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect x="10" y="5" width="60" height="30" fill="#c82850"/></svg>')
    vi.mocked(chromium.launch).mockRestore()
    vi.mocked(assets.discoverPreviewAssets).mockRestore()
    vi.mocked(assetRenderer.renderPreviewAsset).mockRestore()

    const response = await post(`/api/projects/${repo.id}/screenshot`)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.preview).toMatchObject({ kind: 'logo', source: 'repository', assetPath: 'public/logo.svg' })
    expect(result.preview.url).toBeUndefined()
    const image = await fetch(`${address}${result.screenshot}`)
    expect(image.headers.get('content-type')).toContain('image/png')
    const output = PNG.sync.read(Buffer.from(await image.arrayBuffer()))
    expect([output.width, output.height]).toEqual([80, 40])
    expect(output.data[3]).toBe(0)
    expect([...output.data.subarray((20 * 80 + 40) * 4, (20 * 80 + 40) * 4 + 4)]).toEqual([200, 40, 80, 255])
    expect(renderer.capturePage).not.toHaveBeenCalled()
  }, 15_000)
})
