import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Browser } from 'playwright'
import type { RepoProject } from '../src/types'
import { HelperError, type ProjectRegistry, type RegisteredProject } from './scanner'

const execFileAsync = promisify(execFile)
type DevState = NonNullable<RepoProject['dev']>
interface RunningServer {
  child: ChildProcess
  logs: string
  entry: RegisteredProject
  port: number
  stopping: boolean
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local development port.'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

export function devCommand(entry: RegisteredProject, port: number, platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') throw new HelperError('Starting dev servers and capturing previews on Windows are not supported by this POC yet. Run your dev server manually; folder scanning still works.', 501)
  const script = entry.project.scripts.dev
  if (!script) throw new HelperError('This project does not define a dev script in package.json.')
  const manager = entry.project.packageManager
  const command = manager
  const flags = /(?:^|[\s/])vite(?:\s|$)/.test(script)
    ? ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : /(?:^|[\s/])next\s+dev(?:\s|$)/.test(script)
      ? ['--hostname', '127.0.0.1', '--port', String(port)]
      : []
  const args = manager === 'npm' ? ['run', 'dev', ...(flags.length ? ['--', ...flags] : [])] : ['run', 'dev', ...flags]
  return { command, args }
}

function terminate(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch {
    // The process may have already exited between the status check and signal.
  }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class ProjectRuntime {
  private readonly running = new Map<string, RunningServer>()
  private readonly starts = new Map<string, Promise<DevState>>()
  private readonly captures = new Map<string, Promise<string>>()
  private readonly logHistory = new Map<string, string>()
  private readonly screenshots = new Map<string, string>()
  private readonly generations = new Map<string, number>()
  private readonly keepAlive = new Set<string>()
  private readonly browsers = new Set<Browser>()
  private readonly stoppingChildren = new Map<ChildProcess, ReturnType<typeof setTimeout>>()
  private screenshotDirectory?: Promise<string>
  private closed = false

  constructor(private readonly registry: ProjectRegistry) {}

  async status(id: string): Promise<DevState> {
    const entry = this.registry.lookup(id)
    return entry.project.dev ?? { status: 'stopped' }
  }

  async logs(id: string): Promise<string> {
    this.registry.lookup(id)
    return this.running.get(id)?.logs ?? this.logHistory.get(id) ?? ''
  }

  async start(id: string, persistent = true): Promise<DevState> {
    if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
    if (persistent) this.keepAlive.add(id)
    const pending = this.starts.get(id)
    if (pending) return pending
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    const promise = this.startOnce(id, generation)
    this.starts.set(id, promise)
    try {
      return await promise
    } catch (error) {
      if (this.generations.get(id) === generation && !this.running.has(id)) this.keepAlive.delete(id)
      throw error
    } finally {
      if (this.starts.get(id) === promise) this.starts.delete(id)
    }
  }

  private async startOnce(id: string, generation: number): Promise<DevState> {
    const entry = await this.registry.get(id)
    if (this.closed || this.generations.get(id) !== generation) return entry.project.dev ?? { status: 'stopped' }
    if (this.running.has(id)) return entry.project.dev ?? { status: 'starting' }
    const port = await freePort()
    if (this.closed || this.generations.get(id) !== generation) return entry.project.dev ?? { status: 'stopped' }
    const { command, args } = devCommand(entry, port)
    const url = `http://127.0.0.1:${port}`
    const child = spawn(command, args, {
      cwd: entry.directory,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', NO_COLOR: '1' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const running: RunningServer = { child, logs: '', entry, port, stopping: false }
    this.running.set(id, running)
    entry.project.dev = { status: 'starting', url }
    const append = (data: Buffer) => {
      running.logs = `${running.logs}${data.toString()}`.slice(-40_000)
      if (this.running.get(id) === running) this.logHistory.set(id, running.logs)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', (error) => {
      if (this.running.get(id) !== running || running.stopping) return
      const detail = 'code' in error && error.code === 'ENOENT' ? `${entry.project.packageManager} is not installed or is not on the helper's PATH.` : error.message
      entry.project.dev = { status: 'error', error: detail }
      this.running.delete(id)
      this.keepAlive.delete(id)
    })
    child.once('exit', (code) => {
      if (this.running.get(id) !== running || running.stopping) return
      this.running.delete(id)
      this.keepAlive.delete(id)
      if (entry.project.dev?.status !== 'error') {
        entry.project.dev = { status: 'error', error: `The dev server exited${code === null ? '' : ` with code ${code}`}. Check the logs and install project dependencies if needed.` }
      }
    })
    for (let attempt = 0; attempt < 80; attempt++) {
      if (this.running.get(id) !== running || running.stopping) return entry.project.dev ?? { status: 'stopped' }
      try {
        // Receiving any HTTP status proves the server is listening, including
        // projects whose root route intentionally returns a 404.
        const response = await fetch(url, { signal: AbortSignal.timeout(500), redirect: 'manual' })
        await response.body?.cancel()
        if (this.running.get(id) !== running || running.stopping) return entry.project.dev ?? { status: 'stopped' }
        entry.project.dev = { status: 'running', url }
        return entry.project.dev
      } catch {
        await delay(250)
      }
    }
    if (this.running.get(id) !== running) return entry.project.dev ?? { status: 'stopped' }
    const stopping = this.stop(id)
    const stoppedGeneration = this.generations.get(id)
    await stopping
    if (this.generations.get(id) !== stoppedGeneration) return entry.project.dev ?? { status: 'stopped' }
    entry.project.dev = { status: 'error', error: `The dev server did not respond on port ${port}. Vite and Next.js are supported directly; other dev scripts must respect the PORT environment variable. Check the logs.` }
    return entry.project.dev
  }

  async stop(id: string): Promise<DevState> {
    // Stopping a known process must remain possible after its folder moves.
    const entry = this.registry.lookup(id)
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.starts.delete(id)
    this.keepAlive.delete(id)
    const running = this.running.get(id)
    if (running) {
      running.stopping = true
      this.running.delete(id)
      terminate(running.child)
      const timer = setTimeout(() => {
        terminate(running.child, 'SIGKILL')
        this.stoppingChildren.delete(running.child)
      }, 2_000)
      this.stoppingChildren.set(running.child, timer)
      timer.unref()
    }
    entry.project.dev = { status: 'stopped' }
    return entry.project.dev
  }

  async screenshot(id: string): Promise<string> {
    if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
    const pending = this.captures.get(id)
    if (pending) return pending
    const promise = this.captureOnce(id)
    this.captures.set(id, promise)
    try {
      return await promise
    } finally {
      this.captures.delete(id)
    }
  }

  private async captureOnce(id: string): Promise<string> {
    const entry = await this.registry.get(id)
    let capturedServer: RunningServer | undefined
    let browser: Browser | undefined
    try {
      const dev = await this.start(id, false)
      if (dev.status !== 'running' || !dev.url) throw new HelperError(dev.error || 'The dev server could not be started for a screenshot.')
      capturedServer = this.running.get(id)
      const { chromium } = await import('playwright')
      try {
        browser = await chromium.launch({ headless: true, timeout: 15_000 })
        this.browsers.add(browser)
      } catch (error) {
        throw new HelperError(`Screenshot browser is unavailable. Run npx playwright install chromium in the Local Repos folder, then try again. ${error instanceof Error ? error.message.split('\n')[0] : ''}`, 503)
      }
      if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      await page.goto(dev.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1_200)
      if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
      this.screenshotDirectory ??= mkdtemp(path.join(os.tmpdir(), 'local-repos-previews-'))
      const directory = await this.screenshotDirectory
      const filename = path.join(directory, `${id}.png`)
      await page.screenshot({ path: filename, fullPage: false, animations: 'disabled' })
      this.screenshots.set(id, filename)
      const screenshot = `/api/screenshots/${id}.png?v=${Date.now()}`
      entry.project.screenshot = screenshot
      return screenshot
    } finally {
      await browser?.close().catch(() => undefined)
      if (browser) this.browsers.delete(browser)
      // A capture owns only the temporary server it started. An explicit start
      // during capture keeps that server alive; a replacement belongs to its
      // new caller and must never be stopped by an old capture's cleanup.
      if (capturedServer && this.running.get(id) === capturedServer && !this.keepAlive.has(id)) await this.stop(id).catch(() => undefined)
    }
  }

  async screenshotFile(id: string): Promise<string> {
    await this.registry.get(id)
    const filename = this.screenshots.get(id)
    if (!filename) throw new HelperError('No screenshot has been captured for this project yet.', 404)
    return filename
  }

  async open(id: string, app: unknown): Promise<void> {
    const entry = await this.registry.get(id)
    if (app !== 'vscode' && app !== 'sourcetree' && app !== 'folder') throw new HelperError('Choose VS Code, Sourcetree, or the system file browser.')
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('/usr/bin/open', app === 'folder' ? [entry.directory] : ['-a', app === 'vscode' ? 'Visual Studio Code' : 'Sourcetree', entry.directory], { timeout: 10_000 })
      } else if (app === 'vscode') {
        await execFileAsync(process.platform === 'win32' ? 'code.cmd' : 'code', [entry.directory], { timeout: 10_000 })
      } else if (app === 'folder') {
        await execFileAsync(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [entry.directory], { timeout: 10_000 })
      } else {
        throw new HelperError('Opening Sourcetree is currently supported on macOS. Open this project from Sourcetree directly.')
      }
    } catch (error) {
      if (error instanceof HelperError) throw error
      throw new HelperError(`Could not open ${app === 'vscode' ? 'VS Code' : app === 'sourcetree' ? 'Sourcetree' : 'the file browser'}. Make sure it is installed and available on this computer.`)
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true
    this.keepAlive.clear()
    this.starts.clear()
    const servers = [...this.running.values()]
    const stoppedChildren = [...this.stoppingChildren.keys()]
    for (const timer of this.stoppingChildren.values()) clearTimeout(timer)
    this.stoppingChildren.clear()
    for (const running of servers) {
      running.stopping = true
      terminate(running.child)
      running.entry.project.dev = { status: 'stopped' }
    }
    this.running.clear()
    await Promise.all([...this.browsers].map((browser) => browser.close().catch(() => undefined)))
    this.browsers.clear()
    if (servers.length || stoppedChildren.length) {
      await delay(300)
      for (const running of servers) terminate(running.child, 'SIGKILL')
      for (const child of stoppedChildren) terminate(child, 'SIGKILL')
    }
    // A launch already in flight may resolve after shutdown begins. Capture's
    // closed check immediately closes it, and awaiting here prevents orphaning
    // Chromium when the helper's entry point exits the process.
    await Promise.allSettled([...this.captures.values()])
    if (this.screenshotDirectory) await rm(await this.screenshotDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
