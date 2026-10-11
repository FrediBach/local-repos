import { describe, expect, it } from 'vitest'
import { suppressAuditFindings, type ParsedAuditFinding } from './audit-suppressions'
import type { AuditFinding } from '../src/types'

const first = { source: '.trivyignore', ids: ['CVE-2026-12345'], reason: 'First reason' }
const second = { source: '.trivignore', ids: ['CVE-2026-12346'], reason: 'Second reason' }
const rules = new Map([[first.ids[0], first], [second.ids[0], second]])
const advisory = (id: string, severity: AuditFinding['severity'] = 'high'): AuditFinding => ({ name: 'issue', title: id, identifiers: [id], severity })
const node = (name: string, via: string[] = [], advisories: AuditFinding[] = []): ParsedAuditFinding => ({ name, title: name, severity: 'high', via, advisories })
function suppress(findings: ParsedAuditFinding[], reverse: boolean) {
  return suppressAuditFindings({ counts: { info: 0, low: 0, moderate: 0, high: findings.length, critical: 0 }, findings: reverse ? [...findings].reverse() : findings }, rules)
}

describe.each([false, true])('suppression propagation (reversed input: %s)', reverse => {
  it('combines all proven causes through shared dependencies without duplicating provenance', () => {
    const result = suppress([
      node('root', ['left', 'right']), node('left', ['base'], [advisory(second.ids[0])]),
      node('right', ['base']), node('base', [], [advisory(first.ids[0])]),
    ], reverse)
    expect(result.counts.high).toBe(0)
    expect(result.findings.every(finding => finding.suppression)).toBe(true)
    const root = result.findings.find(finding => finding.name === 'root')?.suppression
    expect(root?.ids.toSorted()).toEqual([first.ids[0], second.ids[0]])
    expect(root?.source).toContain(first.source)
    expect(root?.source).toContain(second.source)
    expect(root?.reason).toContain(first.reason)
    expect(root?.reason).toContain(second.reason)
  })

  it('retains cycles and missing causes even when another cause is suppressed', () => {
    const result = suppress([
      node('cycle-a', ['cycle-b', 'base']), node('cycle-b', ['cycle-a']),
      node('missing', ['unknown', 'base']), node('base', [], [advisory(first.ids[0])]),
    ], reverse)
    expect(result.counts.high).toBe(3)
    expect(result.findings.filter(finding => finding.suppression).map(finding => finding.name)).toEqual(['base'])
  })

  it('propagates the highest active severity through shared ancestors after a partial suppression', () => {
    const result = suppress([
      node('root', ['left', 'right']), node('left', ['mixed']), node('right', ['mixed']),
      node('mixed', [], [advisory(first.ids[0]), advisory('active-low', 'low'), advisory('active-critical', 'critical')]),
    ], reverse)
    const active = result.findings.filter(finding => !finding.suppression)
    expect(active).toHaveLength(4)
    expect(active.every(finding => finding.severity === 'critical')).toBe(true)
    expect(result.counts).toEqual({ info: 0, low: 0, moderate: 0, high: 0, critical: 4 })
    expect(result.findings.filter(finding => finding.suppression)).toHaveLength(1)
  })
})
