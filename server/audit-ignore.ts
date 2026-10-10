import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import type { AuditFinding } from '../src/types'
import { HelperError } from './scanner'

export const auditIgnoreFiles = ['.trivyignore', '.trivignore']
type Rule = NonNullable<AuditFinding['suppression']>
const identifier = /^(?:CVE-\d{4}-\d{4,}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/i

export function advisoryIdentifiers(value: Record<string, unknown>): string[] {
  const values = [value.id, value.ghsa_id, value.cve, value.cve_id,
    ...(Array.isArray(value.cves) ? value.cves : []),
    ...(Array.isArray(value.identifiers) ? value.identifiers.map(item => typeof item === 'object' && item ? item.value : item) : [])]
  if (typeof value.url === 'string') {
    try { values.push(...new URL(value.url).pathname.split('/')) } catch { /* No identifier in an invalid URL. */ }
  }
  return [...new Set(values.filter((item): item is string => typeof item === 'string' && identifier.test(item)).map(item => item.toUpperCase()))]
}

export async function readAuditIgnores(directory: string, now = new Date()) {
  const rules = new Map<string, Rule>()
  const warnings: string[] = []
  for (const source of auditIgnoreFiles) {
    const filename = path.join(directory, source)
    let contents: string
    try {
      const info = await lstat(filename)
      if (!info.isFile() || info.size > 64 * 1024) throw new Error('unsafe file')
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const opened = await file.stat()
        if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('changed file')
        const buffer = Buffer.alloc(64 * 1024 + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 64 * 1024) throw new Error('oversized file')
        contents = buffer.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new HelperError(`Cannot read ${source}. Audit ignore files must be readable regular files, not symlinks, and at most 64 KB.`)
    }
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      const [entry, ...comment] = line.split('#')
      if (!entry.trim()) continue
      const [id, ...options] = entry.trim().split(/\s+/)
      // Ignore non-vulnerability Trivy IDs, but never interpret YAML or malformed rules as broad exclusions.
      if (!identifier.test(id)) {
        warnings.push(`${source}:${index + 1}: unsupported ignore entry; only CVE and GHSA IDs are supported.`)
        continue
      }
      const expiry = options[0]?.replace(/^exp:/, '')
      if (options.length && (options.length !== 1 || !options[0].startsWith('exp:') || !/^\d{4}-\d{2}-\d{2}$/.test(expiry!)
        || !Number.isFinite(Date.parse(expiry!)) || new Date(expiry!).toISOString().slice(0, 10) !== expiry)) {
        warnings.push(`${source}:${index + 1}: invalid expiry; rule was not applied.`)
        continue
      }
      if (expiry && now.getTime() >= Date.parse(expiry)) continue
      rules.set(id.toUpperCase(), { source, ids: [id.toUpperCase()], ...(comment.join('#').trim() ? { reason: comment.join('#').trim() } : {}) })
    }
  }
  return { rules, warnings }
}

/** Only public advisory IDs are sent to GitHub; never repository paths or credentials. */
export async function resolveIgnoreAliases(rules: Map<string, Rule>, reportedIds: string[], warnings: string[], fetcher: typeof fetch = fetch) {
  if (![...rules.keys()].some(id => id.startsWith('CVE-'))) return
  const ids = [...new Set(reportedIds)].filter(id => id.startsWith('GHSA-') && !rules.has(id))
  const signal = AbortSignal.timeout(10_000)
  let cursor = 0
  let failures = ids.length > 40
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (cursor < Math.min(ids.length, 40) && !signal.aborted) {
      const id = ids[cursor++]
      try {
        const response = await fetcher(`https://api.github.com/advisories/${id.toLowerCase().replace('ghsa-', 'GHSA-')}`, {
          signal, redirect: 'error', credentials: 'omit',
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'local-repos-audit' },
        })
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 256 * 1024) {
          await response.body?.cancel()
          throw new Error('unavailable advisory')
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            size += value.length
            if (size > 256 * 1024) { await reader.cancel(); throw new Error('oversized advisory') }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!data || typeof data !== 'object' || !('ghsa_id' in data) || typeof data.ghsa_id !== 'string' || data.ghsa_id.toUpperCase() !== id) throw new Error('invalid advisory')
        const match = advisoryIdentifiers(data as Record<string, unknown>).map(alias => rules.get(alias)).find(Boolean)
        if (match) rules.set(id, match)
      } catch { failures = true }
    }
  }))
  if (cursor < ids.length) failures = true
  if (failures) warnings.push('Some CVE aliases could not be verified with GitHub (network, rate limit, or lookup limit). Unmatched findings remain active; scan again to retry.')
}
