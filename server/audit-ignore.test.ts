import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advisoryIdentifiers, readAuditIgnores, resolveIgnoreAliases } from './audit-ignore'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'audit-ignore-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const ghsa = 'GHSA-AAAA-BBBB-CCCC'
const cve = 'CVE-2026-12345'

describe('audit ignore rules', () => {
  it('accepts both filenames, comments, CRLF and future expirations but rejects expired and invalid rules', async () => {
    await writeFile(path.join(directory, '.trivyignore'), `# context\r\n${cve} exp:2026-10-11 # not reachable\r\nCVE-2026-12346 exp:2026-10-10\nCVE-2026-12347 exp:2026-02-30\nCVE-2026-12348 unknown\n`)
    await writeFile(path.join(directory, '.trivignore'), `${ghsa.toLowerCase()}\n`)
    const result = await readAuditIgnores(directory, new Date('2026-10-10T00:00:00Z'))
    expect([...result.rules.keys()]).toEqual([cve, ghsa])
    expect(result.rules.get(cve)).toEqual({ source: '.trivyignore', ids: [cve], reason: 'not reachable' })
    expect(result.warnings).toHaveLength(2)
  })

  it('does not follow symlinks or silently ignore oversized files', async () => {
    await writeFile(path.join(directory, 'target'), cve)
    await symlink(path.join(directory, 'target'), path.join(directory, '.trivyignore'))
    await expect(readAuditIgnores(directory)).rejects.toThrow('regular files')
    await rm(path.join(directory, '.trivyignore'))
    await writeFile(path.join(directory, '.trivyignore'), 'x'.repeat(65537))
    await expect(readAuditIgnores(directory)).rejects.toThrow('64 KB')
  })

  it('extracts exact advisory IDs from structured fields and URLs, never titles or package names', () => {
    expect(advisoryIdentifiers({ cves: [cve], url: `https://github.com/advisories/${ghsa.toLowerCase()}`, title: 'CVE-2026-99999', name: 'CVE-2026-99998' })).toEqual([cve, ghsa])
    expect(advisoryIdentifiers({ url: `https://github.com/advisories/${ghsa}-suffix` })).toEqual([])
  })

  it('resolves CVE aliases using bounded unauthenticated GitHub requests only when needed', async () => {
    const rules = new Map([[cve, { source: '.trivyignore', ids: [cve] }]])
    const warnings: string[] = []
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ghsa_id: ghsa.toLowerCase(), cve_id: cve }))
    await resolveIgnoreAliases(rules, [ghsa, ghsa], warnings, fetcher)
    expect(rules.get(ghsa)).toEqual(rules.get(cve))
    expect(warnings).toEqual([])
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.github.com/advisories/GHSA-aaaa-bbbb-cccc', expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }))
    await resolveIgnoreAliases(rules, [ghsa], warnings, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    () => new Response('rate limited', { status: 403 }),
    () => Response.json({ ghsa_id: 'GHSA-DDDD-EEEE-FFFF', cve_id: cve }),
    () => Response.json({ ghsa_id: ghsa, cve_id: cve, description: 'x'.repeat(300_000) }),
  ])('keeps unmatched findings active and warns on unavailable, invalid or oversized alias responses', async response => {
    const rules = new Map([[cve, { source: '.trivyignore', ids: [cve] }]])
    const warnings: string[] = []
    await resolveIgnoreAliases(rules, [ghsa], warnings, vi.fn<typeof fetch>().mockResolvedValue(response()))
    expect(rules.has(ghsa)).toBe(false)
    expect(warnings).toHaveLength(1)
  })
})
