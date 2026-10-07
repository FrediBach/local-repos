import express, { type NextFunction, type Request, type Response } from 'express'
import { ProjectRuntime } from './runtime'
import { HelperError, ProjectRegistry, scanDirectory } from './scanner'

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
    const { result, registered } = await scanDirectory(request.body?.path)
    registry.register(registered)
    result.projects = registered.map((entry) => entry.project)
    response.json(result)
  })
  app.get('/api/projects/:id/status', async (request, response) => response.json({ dev: await runtime.status(request.params.id) }))
  app.get('/api/projects/:id/logs', async (request, response) => response.json({ logs: await runtime.logs(request.params.id) }))
  app.post('/api/projects/:id/start', async (request, response) => response.json({ dev: await runtime.start(request.params.id) }))
  app.post('/api/projects/:id/stop', async (request, response) => response.json({ dev: await runtime.stop(request.params.id) }))
  app.post('/api/projects/:id/screenshot', async (request, response) => response.json({ screenshot: await runtime.screenshot(request.params.id) }))
  app.post('/api/projects/:id/open', async (request, response) => {
    await runtime.open(request.params.id, request.body?.app)
    response.json({ ok: true })
  })
  app.get('/api/screenshots/:filename', async (request, response) => {
    const match = /^([a-f\d]{20})\.png$/.exec(request.params.filename)
    if (!match) throw new HelperError('Screenshot not found.', 404)
    response.sendFile(await runtime.screenshotFile(match[1]))
  })
  app.use((_request, response) => response.status(404).json({ error: 'Unknown local helper endpoint.' }))
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HelperError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'The request body must be valid JSON.' })
      return
    }
    console.error('[local-repos]', error)
    response.status(500).json({ error: 'The local helper could not complete this action. Check its terminal for details.' })
  })
  return { app, registry, runtime }
}
