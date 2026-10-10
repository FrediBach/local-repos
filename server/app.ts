import express, { type NextFunction, type Request, type Response } from 'express'
import { ProjectRuntime } from './runtime'
import { HelperError, ProjectRegistry, scanDirectory } from './scanner'
import { readGitHistory } from './git-history'
import { readGitDay } from './git-daily-summary'
import { readGitPushStatus } from './git-push-status'
import { packageFingerprint, repositoryFingerprint } from './package-fingerprint'
import type { RegisteredProject } from './scanner'
import { respondWithScan, scanError } from './scan-progress'

export const HELPER_PORT = 4318

const defaultOrigins = ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', `http://localhost:${HELPER_PORT}`, `http://127.0.0.1:${HELPER_PORT}`]

function isLoopbackHost(host: string): boolean {
  // Parsing a bare hostname is stricter than string suffix matching and rejects
  // credentials, paths, and lookalikes used in DNS rebinding attacks.
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false
  try {
    const parsed = new URL(`http://${host}`)
    return parsed.port === '' || Number(parsed.port) <= 65535
  } catch {
    return false
  }
}

export function createApp(options: { allowedOrigins?: string[] } = {}) {
  const app = express()
  const registry = new ProjectRegistry()
  const runtime = new ProjectRuntime(registry)
  const workspaces = new Map<string, RegisteredProject[]>()
  const configuredOrigin = process.env.LOCAL_REPOS_UI_ORIGIN
  const allowedOrigins = new Set(options.allowedOrigins ?? [...defaultOrigins, ...(configuredOrigin ? [configuredOrigin] : [])])
  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const origin = request.get('origin')
    const host = request.get('host') ?? ''
    if (!isLoopbackHost(host) || (origin && !allowedOrigins.has(origin)) || request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json({ error: 'The local helper only accepts requests from the Local Repos app on this computer.' })
      return
    }
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.get('X-Local-Repos') !== '1') {
      response.status(403).json({ error: 'Missing local application request header.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '16kb' }))
  app.get('/api/health', (_request, response) => response.json({ ok: true, platform: process.platform }))
  app.post('/api/scan', async (request, response) => {
    await respondWithScan(request, response, async onProgress => {
      const { result, registered } = await scanDirectory(request.body?.path, onProgress)
      registry.register(registered)
      workspaces.set(result.rootPath!, registered)
      result.projects = registered.map((entry) => entry.project)
      return result
    })
  })
  app.post('/api/package-changes', async (request, response) => {
    const entries = workspaces.get(request.body?.path)
    // After a helper restart the client must first register its workspace again.
    if (!entries) { response.json({ fingerprints: null }); return }
    const fingerprints: Record<string, string> = {}
    const directories = new Map<string, Promise<string>>()
    const fingerprint = (directory: string) => {
      let pending = directories.get(directory)
      if (!pending) { pending = packageFingerprint(directory); directories.set(directory, pending) }
      return pending
    }
    const byDirectory = new Map(entries.map(entry => [entry.directory, entry]))
    const combined = async (entry: RegisteredProject): Promise<string> => {
      const parent = entry.workspaceDirectory && byDirectory.get(entry.workspaceDirectory)
      return repositoryFingerprint(await fingerprint(entry.directory), parent ? await combined(parent) : undefined)
    }
    for (const entry of entries) fingerprints[entry.project.id] = await combined(entry)
    response.json({ fingerprints })
  })
  app.get('/api/projects/:id/status', async (request, response) => response.json({ dev: await runtime.status(request.params.id) }))
  app.get('/api/projects/:id/logs', async (request, response) => response.json({ logs: await runtime.logs(request.params.id) }))
  app.post('/api/projects/:id/history', async (request, response) => {
    const entry = await registry.get(request.params.id)
    response.json(await readGitHistory(entry, request.body ?? {}))
  })
  app.post('/api/projects/:id/daily-summary', async (request, response) => {
    const entry = await registry.get(request.params.id)
    response.json(await readGitDay(entry, request.body ?? {}))
  })
  app.post('/api/projects/:id/push-status', async (request, response) => {
    response.json(await readGitPushStatus(await registry.get(request.params.id)))
  })
  app.post('/api/projects/:id/start', async (request, response) => response.json({ dev: await runtime.start(request.params.id) }))
  app.post('/api/projects/:id/stop', async (request, response) => response.json({ dev: await runtime.stop(request.params.id) }))
  app.post('/api/projects/:id/storage', async (request, response) => respondWithScan(request, response, async onProgress => ({ storage: await runtime.storage(request.params.id, onProgress) })))
  app.post('/api/projects/:id/delete-node-modules', async (request, response) => response.json({ storage: await runtime.deleteNodeModules(request.params.id, request.body?.confirm) }))
  app.post('/api/projects/:id/audit', async (request, response) => respondWithScan(request, response, async onProgress => ({ audit: await runtime.audit(request.params.id, onProgress) })))
  app.post('/api/projects/:id/update-packages', async (request, response) => response.json({ packageUpdate: await runtime.updatePackages(request.params.id, request.body?.level) }))
  app.post('/api/projects/:id/outdated', async (request, response) => respondWithScan(request, response, async onProgress => ({ outdated: await runtime.outdated(request.params.id, onProgress) })))
  app.post('/api/projects/:id/unused', async (request, response) => respondWithScan(request, response, async onProgress => ({ unused: await runtime.unused(request.params.id, onProgress) })))
  app.post('/api/projects/:id/react-doctor', async (request, response) => respondWithScan(request, response, async onProgress => ({ reactDoctor: await runtime.reactDoctor(request.params.id, onProgress) })))
  app.post('/api/projects/:id/lighthouse', async (request, response) => respondWithScan(request, response, async onProgress => ({ lighthouse: await runtime.lighthouse(request.params.id, onProgress) })))
  app.post('/api/projects/:id/screenshot', async (request, response) => {
    const source = request.body?.source ?? 'auto'
    if (source !== 'auto' && source !== 'local' && source !== 'website') throw new HelperError('Choose automatic, local, or website preview capture.')
    await respondWithScan(request, response, async onProgress => {
      const screenshot = await runtime.screenshot(request.params.id, source, onProgress)
      return { screenshot, preview: registry.lookup(request.params.id).project.preview, dev: await runtime.status(request.params.id) }
    })
  })
  app.post('/api/projects/:id/open', async (request, response) => {
    await runtime.open(request.params.id, request.body?.app)
    response.json({ ok: true })
  })
  app.post('/api/projects/:id/run-script', async (request, response) => {
    await runtime.runScript(request.params.id, request.body?.name, request.body?.command, request.body?.terminal)
    response.json({ ok: true })
  })
  app.get('/api/screenshots/:filename', async (request, response) => {
    const match = /^([a-f\d]{20})\.png$/.exec(request.params.filename)
    if (!match) throw new HelperError('Screenshot not found.', 404)
    response.sendFile(await runtime.screenshotFile(match[1]))
  })
  app.use((_request, response) => response.status(404).json({ error: 'Unknown local helper endpoint.' }))
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const failure = scanError(error)
    response.status(failure.status).json({ error: failure.error })
  })
  return { app, registry, runtime }
}
