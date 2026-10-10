import { randomUUID } from 'node:crypto'
import type { ScanProgress } from '../src/types'
import { failure, McpFailure } from './mcp/errors'

export interface Operation {
  operationId: string; helperInstanceId: string; requestId: string; kind: string; projectIds: string[]
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  createdAt: string; startedAt?: string; finishedAt?: string; progress?: ScanProgress
  cancellation: 'stop-after-current'; cancelRequested: boolean; resultKind?: string; resultAvailable: boolean
  error?: { code: string; message: string }
}
interface RecordEntry { principal: string; operation: Operation; result?: unknown[]; bytes: number }
export class Operations {
  private readonly records = new Map<string, RecordEntry>()
  private readonly admissions = new Map<string, { args: string; id: string }>()
  private readonly running = new Set<Promise<void>>()
  private closed = false
  private queuedItems = 0
  constructor(readonly helperInstanceId: string, private readonly now = () => Date.now(), private readonly log: (event: object) => void = () => {}) {}
  private prune() {
    let bytes = [...this.records.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    let terminal = [...this.records.values()].filter(entry => !!entry.operation.finishedAt).sort((a, b) => Date.parse(a.operation.finishedAt!) - Date.parse(b.operation.finishedAt!))
    for (const entry of terminal) {
      if (this.now() - Date.parse(entry.operation.finishedAt!) < 30 * 60_000 && terminal.length <= 200 && bytes <= 32 * 1024 * 1024) continue
      this.records.delete(entry.operation.operationId)
      bytes -= entry.bytes
      terminal = terminal.filter(other => other !== entry)
    }
  }
  admit(principal: string, requestId: string, kind: string, args: unknown, projectIds: string[], work: (context: { operationId: string; progress: (value: ScanProgress) => void; cancelled: () => boolean; invalidated: (count: number) => void }) => Promise<unknown[]>, options: { allowConcurrent?: boolean } = {}) {
    this.prune()
    const key = JSON.stringify([principal, requestId])
    const normalized = JSON.stringify([kind, args])
    const previous = this.admissions.get(key)
    if (previous) {
      if (previous.args !== normalized) throw new McpFailure('REQUEST_ID_CONFLICT', 'This request ID was already used with different arguments.')
      if (!this.records.has(previous.id)) throw new McpFailure('REQUEST_EXPIRED', 'This request was admitted but its result has expired. Do not replay it.')
      return this.get(principal, previous.id)
    }
    if (this.closed) throw new McpFailure('HELPER_SHUTTING_DOWN', 'The helper is shutting down.')
    if (this.admissions.size >= 10_000 || this.queuedItems + Math.max(1, projectIds.length) > 100) throw new McpFailure('RESOURCE_LIMIT', 'The helper operation limit was reached.')
    if (!options.allowConcurrent && [...this.records.values()].some(entry => entry.principal === principal && !entry.operation.finishedAt)) throw new McpFailure('PROJECT_BUSY', 'Wait for your current operation to finish.', true)
    const operation: Operation = { operationId: `op_${randomUUID()}`, helperInstanceId: this.helperInstanceId, requestId, kind, projectIds, state: 'queued', createdAt: new Date(this.now()).toISOString(), cancellation: 'stop-after-current', cancelRequested: false, resultAvailable: false }
    const entry: RecordEntry = { principal, operation, bytes: 0 }
    this.admissions.set(key, { args: normalized, id: operation.operationId })
    this.records.set(operation.operationId, entry)
    this.queuedItems += Math.max(1, projectIds.length)
    let invalidationCount = 0
    const task = Promise.resolve().then(async () => {
      if (operation.cancelRequested) { operation.state = 'cancelled'; return }
      operation.state = 'running'
      operation.startedAt = new Date(this.now()).toISOString()
      try {
        const result = await work({ operationId: operation.operationId, progress: value => { operation.progress = value }, cancelled: () => operation.cancelRequested, invalidated: count => { invalidationCount += count } })
        const bytes = Buffer.byteLength(JSON.stringify(result))
        if (bytes > 8 * 1024 * 1024) throw new McpFailure('RESOURCE_LIMIT', 'Operation results exceeded 8 MiB.')
        entry.result = result
        entry.bytes = bytes
        operation.resultKind = kind
        operation.resultAvailable = true
        operation.state = 'succeeded'
      } catch (error) {
        const problem = failure(error)
        operation.error = { code: problem.code, message: problem.message }
        operation.state = 'failed'
      }
    }).finally(() => {
      operation.finishedAt = new Date(this.now()).toISOString()
      this.running.delete(task)
      this.queuedItems -= Math.max(1, projectIds.length)
      this.prune()
      try { this.log({ operationId: operation.operationId, kind, projectIds, state: operation.state, durationMs: this.now() - Date.parse(operation.createdAt), invalidationCount }) }
      catch { /* Diagnostics cannot change an operation outcome. */ }
    })
    this.running.add(task)
    return { ...operation }
  }
  private entry(principal: string, id: string) {
    this.prune()
    const entry = this.records.get(id)
    if (!entry && [...this.admissions].some(([key, value]) => value.id === id && JSON.parse(key)[0] === principal)) throw new McpFailure('REQUEST_EXPIRED', 'The operation result expired; the request will not be replayed.')
    if (!entry || entry.principal !== principal) throw new McpFailure('OPERATION_NOT_FOUND', 'Operation not found or expired.')
    return entry
  }
  get(principal: string, id: string) { return { ...this.entry(principal, id).operation } }
  result(principal: string, id: string) {
    const entry = this.entry(principal, id)
    if (!entry.operation.finishedAt) throw new McpFailure('PROJECT_BUSY', 'The result is not ready.', true)
    return entry.result ?? []
  }
  cancel(principal: string, id: string) {
    const entry = this.entry(principal, id)
    if (!entry.operation.finishedAt) entry.operation.cancelRequested = true
    return { ...entry.operation }
  }
  active() {
    return [...this.records.values()].filter(entry => !entry.operation.finishedAt).map(({ operation }) => ({ operationId: operation.operationId, kind: operation.kind, projectIds: [...operation.projectIds], progress: operation.progress }))
  }
  async shutdown() {
    this.closed = true
    for (const entry of this.records.values()) if (!entry.operation.finishedAt) entry.operation.cancelRequested = true
    await Promise.allSettled(this.running)
  }
}
