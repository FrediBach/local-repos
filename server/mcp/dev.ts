import type { HelperApplication } from '../application'
import type { Principal } from './policy'
import { McpFailure } from './errors'
import { cleanText, Cursors, digest, utf8Chunk } from './output'

interface LogSnapshot { text: string; generation?: string; truncated: boolean; at: string; expires: number }

/** Freeze sanitized tails while paging; new reads refresh, appends do not reshuffle pages. */
export class DevReads {
  private readonly snapshots = new Map<string, LogSnapshot>()
  private readonly cursors = new Cursors()
  constructor(private readonly application: HelperApplication) {}

  logs(principal: Principal, projectId: string, query: { cursor?: string; maxBytes?: number }) {
    this.application.index.processEntry(principal, projectId)
    if (!principal.discloseContent) throw new McpFailure('CAPABILITY_DISABLED', 'Log content disclosure is disabled.')
    for (const [key, value] of this.snapshots) if (value.expires < Date.now()) this.snapshots.delete(key)
    const key = JSON.stringify([principal.id, projectId])
    let snapshot = this.snapshots.get(key)
    let offset = 0
    let resetRequired = false
    const binding = (value: LogSnapshot) => ['dev-logs', principal.id, projectId, value.generation, value.at, digest(value.text)]
    if (query.cursor) {
      if (!snapshot) throw new McpFailure('CURSOR_EXPIRED', 'The log snapshot expired. Read a fresh tail without a cursor.')
      offset = this.cursors.offset(query.cursor, binding(snapshot))
      resetRequired = snapshot.generation !== this.application.runtime.devStatus(projectId).processGeneration
    }
    if (!query.cursor || resetRequired) {
      const logs = this.application.runtime.logSnapshot(projectId)
      // Repository logs are untrusted. Redaction is best-effort, not a secrets boundary.
      const text = cleanText(logs.text, principal).replace(/\b(authorization\s*[:=]\s*(?:bearer\s+)?|(?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s]+/gi, '$1[redacted]')
      const bytes = Buffer.from(text)
      let start = Math.max(0, bytes.length - 64 * 1024)
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
      snapshot = { text: bytes.subarray(start).toString('utf8'), generation: logs.processGeneration, truncated: logs.truncated || start > 0, at: new Date().toISOString(), expires: Date.now() + 5 * 60_000 }
      this.snapshots.delete(key)
      this.snapshots.set(key, snapshot)
      while (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value!)
      offset = 0
    }
    const page = utf8Chunk(snapshot!.text, offset, query.maxBytes ?? 8192)
    return { text: page.text, processGeneration: snapshot!.generation, truncated: snapshot!.truncated || page.end < page.total, resetRequired, snapshotAt: snapshot!.at, nextCursor: page.end < page.total ? this.cursors.encode(binding(snapshot!), page.end) : null }
  }
}
