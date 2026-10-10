import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ProjectRuntime } from './runtime'
import { HelperError, ProjectRegistry, scanDirectory, type RegisteredProject } from './scanner'
import type { ScanProgressReporter } from '../src/types'
import { Operations } from './operations'
import { rootId } from './mcp/policy'
import { ProjectIndex } from './project-index'
import type { ReportKind } from './mcp/schemas'

export interface RootSnapshot {
  id: string; directory: string; scannedAt: string; warnings: string[]
  members: Map<string, { relativePath: string; observed: boolean; lastSeenAt: string }>
}
export class HelperApplication {
  readonly helperInstanceId = `boot_${randomUUID()}`
  readonly registry = new ProjectRegistry()
  readonly runtime = new ProjectRuntime(this.registry, (entries, reason) => {
    for (const entry of entries) this.index.invalidate(entry.project, reason)
  })
  readonly operations: Operations
  readonly workspaces = new Map<string, RegisteredProject[]>()
  readonly roots = new Map<string, RootSnapshot>()
  readonly index = new ProjectIndex(this)
  revision = 0
  private closed = false
  private readonly scans = new Set<Promise<unknown>>()

  constructor(log?: (event: object) => void) {
    this.operations = new Operations(this.helperInstanceId, () => Date.now(), log)
  }

  async scan(input: unknown, onProgress?: ScanProgressReporter, expectedRoot?: string) {
    const release = this.runtime.reserveMetadataScan()
    const task = (async () => {
      try {
        const { result, registered } = await scanDirectory(input, onProgress)
        if (this.closed) throw new HelperError('Helper shutting down', 503)
        if (expectedRoot && result.rootPath !== expectedRoot) throw new HelperError('The configured root path changed.', 403)
        const changed = registered.filter(entry => {
          try { return this.registry.lookup(entry.project.id).project.packageFingerprint !== entry.project.packageFingerprint }
          catch { return false }
        }).map(entry => entry.project.id)
        this.registry.register(registered, id => this.runtime.scopeBusy(id))
        for (const projectId of changed) for (const member of this.registry.related(projectId)) this.index.invalidate(member.project, 'Package metadata changed; stat fingerprints do not establish report freshness.')
        this.workspaces.set(result.rootPath!, registered)
        const id = rootId(result.rootPath!)
        const old = this.roots.get(id)
        const members: RootSnapshot['members'] = new Map([...old?.members ?? []].map(([key, value]) => [key, { ...value, observed: false }]))
        for (const entry of registered) members.set(entry.project.id, { relativePath: path.relative(result.rootPath!, entry.directory) || '.', observed: true, lastSeenAt: result.syncedAt })
        this.roots.set(id, { id, directory: result.rootPath!, scannedAt: result.syncedAt, warnings: result.warnings ?? [], members })
        this.revision++
        result.projects = registered.map(entry => entry.project)
        return { ...result, rootId: id, helperInstanceId: this.helperInstanceId, revision: this.revision }
      } finally { release() }
    })()
    this.scans.add(task)
    try { return await task } finally { this.scans.delete(task) }
  }
  async readReport<T>(projectId: string, kind: ReportKind, run: () => Promise<T>): Promise<T> {
    const project = this.registry.lookup(projectId).project
    const operationId = `rest_${randomUUID()}`
    this.index.attempt(project, kind, 'running', operationId)
    try {
      const result = await run()
      this.index.attempt(project, kind, 'succeeded', operationId)
      return result
    } catch (error) {
      this.index.attempt(project, kind, 'failed', operationId)
      throw error
    }
  }
  async shutdown() {
    this.closed = true
    await this.runtime.shutdown()
    await this.operations.shutdown()
    await Promise.allSettled(this.scans)
  }
}
