import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Browser } from 'playwright'
import type { PackageUpdate, PackageAudit, PackageOutdated, PackageUnused, PreviewMode, ProjectStorage, RepoProject } from '../src/types'
import { HelperError, type ProjectRegistry, type RegisteredProject } from './scanner'
import { selectDevScript } from '../src/lib/dev-script'
import { configuredServerUrls, devCommand, discoverServerUrls } from './dev-server'
import { capturePage } from './preview-renderer'
import { getPackagePreviewTargets, resolveGithubHomepage } from './preview-sources'
import { discoverPreviewAssets, type PreviewAssetCandidate } from './preview-assets'
import { renderPreviewAsset } from './preview-asset-renderer'
import { auditProject } from './package-audit'
import { updateProject } from './package-update'
import { parsePackageJson } from '../src/lib/metadata'
import { outdatedProject } from './package-outdated'
import { unusedProject } from './package-unused'
import { measureProjectStorage, removeProjectNodeModules } from './project-storage'
import { openScriptTerminal, validateProjectScript } from './project-scripts'

export { devCommand } from './dev-server'

const execFileAsync = promisify(execFile)
type DevState = NonNullable<RepoProject['dev']>
type PreviewDetails = Omit<NonNullable<RepoProject['preview']>, 'capturedAt'>
type CaptureTarget = { url: string; source: 'local' | 'configured' | 'package' | 'github' }
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

function serverResponds(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const client = url.startsWith('https:') ? https : http
    // Every candidate is loopback-only. Local framework HTTPS often uses a
    // self-signed certificate; never apply this setting to remote websites.
    const request = client.get(url, { timeout: 650, rejectUnauthorized: false }, response => { response.resume(); resolve(true) })
    request.on('error', () => resolve(false))
    request.on('timeout', () => { request.destroy(); resolve(false) })
  })
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
  private readonly storageScans = new Map<string, Promise<ProjectStorage>>()
  private readonly audits = new Map<string, Promise<PackageAudit>>()
  private readonly outdatedScans = new Map<string, Promise<PackageOutdated>>()
  private readonly unusedScans = new Map<string, Promise<PackageUnused>>()
  private readonly updates = new Map<string, Promise<PackageUpdate>>()
  private readonly removals = new Map<string, Promise<ProjectStorage>>()
  private readonly maintenance = new Set<string>()
  private readonly logHistory = new Map<string, string>()
  private readonly screenshots = new Map<string, string>()
  private readonly generations = new Map<string, number>()
  private readonly keepAlive = new Set<string>()
  private readonly browsers = new Set<Browser>()
  private readonly stoppingChildren = new Map<ChildProcess, { id: string; timer: ReturnType<typeof setTimeout> }>()
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

  private available(id: string): void {
    this.registry.lookup(id)
    if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
    if (this.registry.related(id).some(entry => this.maintenance.has(entry.project.id))) throw new HelperError('Dependencies are being changed in this repository. Wait until maintenance finishes before taking another action.', 409)
  }

  async storage(id: string): Promise<ProjectStorage> {
    this.available(id)
    const pending = this.storageScans.get(id)
    if (pending) return pending
    const promise = (async () => {
      const entry = await this.registry.get(id)
      const storage = await measureProjectStorage(entry.directory)
      entry.project.storage = storage
      return storage
    })()
    this.storageScans.set(id, promise)
    try { return await promise }
    finally { this.storageScans.delete(id) }
  }

  async audit(id: string): Promise<PackageAudit> {
    this.available(id)
    const pending = this.audits.get(id)
    if (pending) return pending
    const promise = (async () => {
      const entry = await this.registry.get(id)
      const audit = await auditProject(entry)
      entry.project.audit = audit
      return audit
    })()
    this.audits.set(id, promise)
    try { return await promise }
    finally { this.audits.delete(id) }
  }

  async outdated(id: string): Promise<PackageOutdated> {
    this.available(id)
    const pending = this.outdatedScans.get(id)
    if (pending) return pending
    const promise = (async () => {
      const entry = await this.registry.get(id)
      const outdated = await outdatedProject(entry)
      entry.project.outdated = outdated
      return outdated
    })()
    this.outdatedScans.set(id, promise)
    try { return await promise }
    finally { this.outdatedScans.delete(id) }
  }

  async unused(id: string): Promise<PackageUnused> {
    this.available(id)
    const pending = this.unusedScans.get(id)
    if (pending) return pending
    const promise = (async () => {
      const entry = await this.registry.get(id)
      const unused = await unusedProject(entry)
      entry.project.unused = unused
      return unused
    })()
    this.unusedScans.set(id, promise)
    try { return await promise }
    finally { this.unusedScans.delete(id) }
  }

  async updatePackages(id: string, level: unknown): Promise<PackageUpdate> {
    this.available(id)
    if (level !== 'minor' && level !== 'patch') throw new HelperError('Choose a minor or patch update.', 400)
    const related = this.registry.related(id)
    for (const { project } of related) {
      const key = project.id
      if (this.running.has(key) || this.starts.has(key) || this.captures.has(key)
        || this.storageScans.has(key) || this.audits.has(key) || this.outdatedScans.has(key) || this.unusedScans.has(key)
        || [...this.stoppingChildren.values()].some(child => child.id === key)) {
        throw new HelperError('Stop dev servers and wait for previews and package scans in this repository to finish before updating dependencies.', 409)
      }
    }
    this.maintenance.add(id)
    const promise = (async () => {
      const entry = await this.registry.get(id)
      try {
        const update = await updateProject(entry, level)
        entry.project.packageUpdate = update
        return update
      } finally {
        // Installs can partially succeed before failing. Never keep old scores.
        for (const member of related) {
          member.project.audit = undefined
          member.project.outdated = undefined
          member.project.unused = undefined
          member.project.storage = undefined
          try {
            const metadata = parsePackageJson(await readFile(path.join(member.directory, 'package.json'), 'utf8'))
            member.project.dependencies = metadata.dependencies
          } catch { member.project.dependencies = undefined }
        }
      }
    })()
    this.updates.set(id, promise)
    try { return await promise }
    finally { this.updates.delete(id); this.maintenance.delete(id) }
  }

  async deleteNodeModules(id: string, confirm: unknown): Promise<ProjectStorage> {
    this.available(id)
    if (confirm !== true) throw new HelperError('Confirm removal of this project’s node_modules folder before continuing.', 400)
    const relatedIds = this.registry.related(id).map(entry => entry.project.id)
    if (relatedIds.some(key => this.running.has(key) || this.starts.has(key) || this.captures.has(key))
      || [...this.stoppingChildren.values()].some(child => relatedIds.includes(child.id))) {
      throw new HelperError('Stop the project’s dev server and wait for preview capture and server shutdown to finish before removing dependencies.', 409)
    }
    if (relatedIds.some(key => this.storageScans.has(key) || this.audits.has(key) || this.outdatedScans.has(key) || this.unusedScans.has(key))) {
      throw new HelperError('Wait for disk usage measurement and package scans to finish before removing dependencies.', 409)
    }
    // Reserve before any filesystem await so a simultaneous start, screenshot,
    // or second cleanup cannot slip between validation and recursive removal.
    this.maintenance.add(id)
    const promise = (async () => {
      const entry = await this.registry.get(id)
      const storage = await removeProjectNodeModules(entry.directory)
      entry.project.storage = storage
      return storage
    })()
    this.removals.set(id, promise)
    try { return await promise }
    finally {
      this.removals.delete(id)
      this.maintenance.delete(id)
    }
  }

  async start(id: string, persistent = true): Promise<DevState> {
    this.available(id)
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
    const { command, args, env } = devCommand(entry, port)
    const url = `http://127.0.0.1:${port}`
    const child = spawn(command, args, {
      cwd: entry.directory,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', NO_COLOR: '1', ...env },
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
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (this.running.get(id) !== running || running.stopping) return entry.project.dev ?? { status: 'stopped' }
      const candidates = [...new Set([
        ...discoverServerUrls(running.logs),
        ...configuredServerUrls(selectDevScript(entry.project)?.command ?? '', port),
        url,
      ])].slice(0, 8)
      const responses = await Promise.all(candidates.map(async candidate => ({ candidate, ready: await serverResponds(candidate) })))
      if (this.running.get(id) !== running || running.stopping) return entry.project.dev ?? { status: 'stopped' }
      const ready = responses.find(response => response.ready)
      if (ready) {
        entry.project.dev = { status: 'running', url: ready.candidate }
        return entry.project.dev
      }
      await delay(250)
    }
    if (this.running.get(id) !== running) return entry.project.dev ?? { status: 'stopped' }
    const stopping = this.stop(id)
    const stoppedGeneration = this.generations.get(id)
    await stopping
    if (this.generations.get(id) !== stoppedGeneration) return entry.project.dev ?? { status: 'stopped' }
    entry.project.dev = { status: 'error', error: `The dev server did not become ready within 45 seconds. We checked its configured port and local URLs printed in its logs. Check the logs, or capture from the project's website instead.` }
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
        if (!running.child.pid || running.child.exitCode !== null || running.child.signalCode !== null) {
          this.stoppingChildren.delete(running.child)
        } else {
          // Sending SIGKILL is not itself confirmation of process exit. Keep
          // dependency cleanup blocked until the child has actually stopped.
          running.child.once('exit', () => this.stoppingChildren.delete(running.child))
        }
      }, 2_000)
      this.stoppingChildren.set(running.child, { id, timer })
      timer.unref()
    }
    entry.project.dev = { status: 'stopped' }
    return entry.project.dev
  }

  async screenshot(id: string, source: PreviewMode = 'auto'): Promise<string> {
    this.available(id)
    const pending = this.captures.get(id)
    if (pending) return pending
    const promise = this.captureOnce(id, source)
    this.captures.set(id, promise)
    try {
      return await promise
    } finally {
      this.captures.delete(id)
    }
  }

  private async captureOnce(id: string, source: PreviewMode): Promise<string> {
    const entry = await this.registry.get(id)
    let capturedServer: RunningServer | undefined
    let browser: Browser | undefined
    try {
      const failures: string[] = []
      const attempted = new Set<string>()
      const attemptedTargets: CaptureTarget[] = []
      const localAssets: PreviewAssetCandidate[] = []
      const targets = getPackagePreviewTargets(entry.project)
      const ensureBrowser = async (): Promise<Browser> => {
        if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
        if (!browser) {
          const { chromium } = await import('playwright')
          try {
            browser = await chromium.launch({ headless: true, timeout: 15_000 })
            this.browsers.add(browser)
          } catch (error) {
            throw new HelperError(`Screenshot browser is unavailable. Run npx playwright install chromium in the Local Repos folder, then try again. ${error instanceof Error ? error.message.split('\n')[0] : ''}`, 503)
          }
        }
        if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
        return browser
      }
      const save = async (png: Buffer, details: PreviewDetails): Promise<string> => {
        if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
        this.screenshotDirectory ??= mkdtemp(path.join(os.tmpdir(), 'local-repos-previews-'))
        const filename = path.join(await this.screenshotDirectory, `${id}.png`)
        await writeFile(filename, png)
        this.screenshots.set(id, filename)
        const screenshot = `/api/screenshots/${id}.png?v=${Date.now()}`
        entry.project.screenshot = screenshot
        entry.project.preview = { ...details, capturedAt: new Date().toISOString() }
        return screenshot
      }
      const capture = async (target: CaptureTarget): Promise<string | undefined> => {
        if (attempted.has(target.url)) return
        attempted.add(target.url)
        attemptedTargets.push(target)
        const activeBrowser = await ensureBrowser()
        try {
          const png = await capturePage(activeBrowser, target.url)
          return await save(png, { ...target, kind: 'screenshot' })
        } catch (error) {
          if (this.closed) throw error
          failures.push(`${target.source === 'local' ? 'Local preview' : 'Project URL'} (${target.url}): ${error instanceof Error ? error.message : 'Capture failed.'}`)
          return
        }
      }

      const rememberLocalAssets = async (target: CaptureTarget) => {
        // Frameworks may generate metadata and image routes that do not exist
        // as named files. Save those bytes before stopping our temporary server,
        // but prefer any successful website screenshot over these images.
        const deadline = Date.now() + 8_000
        try {
          const assets = await discoverPreviewAssets(await ensureBrowser(), undefined, [target])
          for (const asset of assets.slice(0, 10)) {
            if (this.closed || Date.now() >= deadline) break
            const image = await asset.load()
            if (image) localAssets.push({ ...asset, load: async () => image })
          }
        } catch (error) {
          if (this.closed) throw error
        }
      }

      // An explicit preview route is an override; inferred homepages are used
      // after trying the local application, unless Project URL was selected.
      if (source !== 'local') {
        for (const target of targets.filter(target => target.source === 'configured')) {
          const result = await capture(target)
          if (result) return result
        }
      }
      if (source !== 'website') {
        if (selectDevScript(entry.project)) {
          let dev: DevState | undefined
          try { dev = await this.start(id, false) }
          catch (error) { failures.push(error instanceof Error ? error.message : 'The local server could not start.') }
          if (dev?.status === 'running' && dev.url) {
            capturedServer = this.running.get(id)
            const result = await capture({ url: dev.url, source: 'local' })
            if (result) return result
            await rememberLocalAssets({ url: dev.url, source: 'local' })
          } else if (dev) failures.push(dev.error || 'The local server did not start.')
          // A failed/blank local preview should not keep a temporary process
          // alive while an unrelated deployed website is being captured.
          if (capturedServer && this.running.get(id) === capturedServer && !this.keepAlive.has(id)) await this.stop(id)
        } else failures.push('No dev, start, or serve script is configured.')
      }
      if (source !== 'local') {
        for (const target of targets.filter(target => target.source !== 'configured')) {
          const result = await capture(target)
          if (result) return result
        }
        const github = await resolveGithubHomepage(entry.project.git?.origin)
        if (github) {
          const result = await capture(github)
          if (result) return result
        } else failures.push('No additional website was found in the GitHub repository’s public homepage setting.')
      }
      // A rendered application is always preferred. Only after every eligible
      // page fails do we try its social image, branding, and finally icons.
      // Temporary local servers are already stopped; their static assets can
      // still be read from the repository without starting the app again.
      try {
        const fallbackDeadline = Date.now() + 25_000
        const activeBrowser = await ensureBrowser()
        const discovered = await discoverPreviewAssets(activeBrowser, source === 'website' ? undefined : entry.directory, attemptedTargets.filter(target => target.source !== 'local'))
        const kindOrder = { 'og-image': 0, logo: 1, favicon: 2 }
        const sourceOrder = { configured: 0, local: 1, package: 2, github: 3, repository: 4 }
        const seen = new Set<string>()
        const assets = [...discovered, ...localAssets].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || sourceOrder[a.source] - sourceOrder[b.source]).filter(asset => {
          const key = asset.assetUrl ?? asset.assetPath
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        })
        for (const asset of assets) {
          if (this.closed) throw new HelperError('The local helper is shutting down.', 503)
          if (Date.now() >= fallbackDeadline) break
          try {
            const image = await asset.load()
            if (!image || this.closed || Date.now() >= fallbackDeadline) continue
            const png = await renderPreviewAsset(activeBrowser, image, asset.kind)
            return await save(png, { kind: asset.kind, source: asset.source, url: asset.url, assetUrl: asset.assetUrl, assetPath: asset.assetPath })
          } catch (error) {
            if (this.closed) throw error
            // A missing or corrupt OG image should not hide a valid logo/icon.
          }
        }
        failures.push('No usable Open Graph image, logo, or favicon was found.')
      } catch (error) {
        if (this.closed) throw error
        failures.push(`Image fallback: ${error instanceof Error ? error.message : 'No usable image was found.'}`)
      }
      throw new HelperError(`Could not capture a preview. ${failures.join(' ')} Set package.json homepage or localRepos.previewUrl to the application URL or route to use.`, 422)
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

  async runScript(id: string, name: unknown, command: unknown): Promise<void> {
    this.available(id)
    const entry = await this.registry.get(id)
    const selected = await validateProjectScript(entry, name, command)
    this.available(id)
    await openScriptTerminal(entry, selected)
  }

  async shutdown(): Promise<void> {
    this.closed = true
    this.keepAlive.clear()
    this.starts.clear()
    const servers = [...this.running.values()]
    const stoppedChildren = [...this.stoppingChildren.keys()]
    for (const { timer } of this.stoppingChildren.values()) clearTimeout(timer)
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
    await Promise.allSettled([...this.storageScans.values(), ...this.audits.values(), ...this.outdatedScans.values(), ...this.unusedScans.values(), ...this.removals.values(), ...this.updates.values()])
    if (this.screenshotDirectory) await rm(await this.screenshotDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
