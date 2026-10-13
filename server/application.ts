import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ProjectRuntime } from './runtime'
import { HelperError, ProjectRegistry, scanDirectory, type RegisteredProject } from './scanner'
import { reportKinds, type GitRepository, type HelperReportKind, type RepoProject, type HelperActivity, type WorkspaceState, type ScanProgressReporter } from '../src/types'
import { MaintenancePlans } from './mcp/maintenance-plans'
import { Operations } from './operations'
import { rootId } from './mcp/policy'
import { ProjectIndex } from './project-index'
import { checkRepositorySnapshot, readRepositoryGitDay, readRepositoryGitHistory, readRepositoryGitPushStatus, repositoryGitEntries } from './git-repository'

export interface RootSnapshot {
  id: string; directory: string; scannedAt: string; warnings: string[]
  members: Map<string, { relativePath: string; observed: boolean; lastSeenAt: string }>
  repositories?: GitRepository[]
}
export class HelperApplication {
  readonly helperInstanceId = `boot_${randomUUID()}`
  readonly registry = new ProjectRegistry()
  readonly runtime = new ProjectRuntime(this.registry, (entries, reason) => {
    const revision = ++this.revision
    for (const entry of entries) this.index.invalidate(entry.project, reason, revision)
  }, () => { this.revision++ })
  readonly maintenancePlans = new MaintenancePlans(this)
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
        const invalidated = new Map(changed.flatMap(id => this.registry.related(id)).map(entry => [entry.project.id, entry]))
        const invalidationRevision = invalidated.size ? ++this.revision : this.revision
        for (const member of invalidated.values()) this.index.invalidate(member.project, 'Package metadata changed; stat fingerprints do not establish report freshness.', invalidationRevision)
        this.workspaces.set(result.rootPath!, registered)
        const id = rootId(result.rootPath!)
        const old = this.roots.get(id)
        const members: RootSnapshot['members'] = new Map([...old?.members ?? []].map(([key, value]) => [key, { ...value, observed: false }]))
        for (const entry of registered) members.set(entry.project.id, { relativePath: path.relative(result.rootPath!, entry.directory) || '.', observed: true, lastSeenAt: result.syncedAt })
        const repositories = result.repositories?.map(repository => {
          const previous = old?.repositories?.find(value => value.id === repository.id)
          if (!previous || repository.status !== 'unavailable') return repository
          // Failed inventory reads keep their dated snapshot with unavailable freshness.
          const observedIds = new Set(repository.worktrees.map(worktree => worktree.id))
          return { ...repository, checkedAt: previous.checkedAt, worktrees: [...repository.worktrees, ...previous.worktrees.filter(worktree => !observedIds.has(worktree.id))] }
        })
        for (const [projectId, member] of old?.members ?? []) {
          if (!member.observed || members.get(projectId)?.observed) continue
          const previous = this.registry.lookup(projectId).project.gitContext
          if (previous?.state !== 'verified') continue
          const inventory = repositories?.find(repository => repository.id === previous.repositoryId)
          const worktree = inventory?.worktrees.find(row => row.id === previous.worktreeId)
          if (inventory?.status === 'unavailable' || worktree?.availability === 'unavailable' || worktree?.availability === 'unscanned') members.set(projectId, member)
        }
        this.roots.set(id, { id, directory: result.rootPath!, scannedAt: result.syncedAt, warnings: result.warnings ?? [], members, repositories })
        this.revision++
        result.projects = [...members].filter(([, member]) => member.observed).map(([projectId]) => this.projectState(this.registry.lookup(projectId).project, result.rootPath))
        result.repositories = repositories
        return { ...result, rootId: id, helperInstanceId: this.helperInstanceId, revision: this.revision }
      } finally { release() }
    })()
    this.scans.add(task)
    try { return await task } finally { this.scans.delete(task) }
  }
  async repositoryHistory(projectId: string, input: Record<string, unknown>) {
    const { scope, checkouts, root } = await repositoryGitEntries(this, projectId, input)
    const result = await readRepositoryGitHistory(scope.repositoryId, checkouts, input)
    checkRepositorySnapshot(this, root)
    return result
  }
  async repositoryDay(projectId: string, input: Record<string, unknown>) {
    const { scope, checkouts, root } = await repositoryGitEntries(this, projectId, input)
    const result = await readRepositoryGitDay(scope.repositoryId, checkouts, input)
    checkRepositorySnapshot(this, root)
    return result
  }
  async repositoryPushStatus(projectId: string, input: Record<string, unknown>) {
    const { scope, checkouts, root } = await repositoryGitEntries(this, projectId, input)
    const result = await readRepositoryGitPushStatus(scope.repositoryId, checkouts)
    checkRepositorySnapshot(this, root)
    return result
  }
  async readReport<T>(projectId: string, kind: HelperReportKind, run: () => Promise<T>, operationId = `rest_${randomUUID()}`): Promise<T> {
    const project = this.registry.lookup(projectId).project
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
  projectState(project: RepoProject, rootDirectory?: string): RepoProject {
    const copy = { ...project, reportState: { ...project.reportState } }
    if (rootDirectory) {
      const entry = this.registry.lookup(project.id)
      copy.relativePath = path.relative(rootDirectory, entry.directory) || '.'
      if (copy.gitContext?.state === 'verified' && entry.gitIdentity) copy.gitContext = { ...copy.gitContext, checkoutPath: path.relative(rootDirectory, entry.gitIdentity.checkoutDirectory) || '.' }
    }
    for (const kind of reportKinds) {
      const state = this.index.reportState(project, kind)
      copy.reportState[kind] = { helperInstanceId: this.helperInstanceId, revision: state.revision, validity: state.invalidation ? 'invalidated' : project[kind] ? 'available' : 'missing', reason: state.invalidation?.reason }
      if (state.invalidation) copy[kind] = undefined
    }
    return copy
  }
  workspaceState(rootId: string, helperInstanceId?: string, afterRevision?: number): WorkspaceState {
    const root = this.roots.get(rootId)
    const projects = [...root?.members ?? []].filter(([, member]) => member.observed).map(([id]) => this.projectState(this.registry.lookup(id).project, root?.directory))
    const ids = new Set(projects.map(project => project.id))
    const scoped = (operation: HelperActivity): HelperActivity => ({ ...operation, projectIds: [...new Set(operation.projectIds.flatMap(id => this.registry.related(id).map(entry => entry.project.id)))].filter(id => ids.has(id)) })
    const admitted = this.operations.active().map(scoped).filter(operation => operation.projectIds.length)
    const activeOperations = [...admitted, ...this.runtime.activeWork().map(scoped).filter(operation => operation.projectIds.length && !admitted.some(other => other.projectIds.some(id => operation.projectIds.includes(id))))]
    return { rootId, helperInstanceId: this.helperInstanceId, revision: this.revision, registered: !!root, resetRequired: helperInstanceId !== this.helperInstanceId || !root || (afterRevision ?? 0) > this.revision, projects, activeOperations, warnings: root?.warnings ?? [], repositories: root?.repositories }
  }
  async shutdown() {
    this.closed = true
    await this.runtime.shutdown()
    await this.operations.shutdown()
    await Promise.allSettled(this.scans)
  }
}
