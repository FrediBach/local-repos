import { describe, expect, it } from 'vitest'
import { newCriticalVulnerabilities } from './critical-vulnerabilities'
import type { AuditFinding, PackageAudit } from '@/types'

const finding: AuditFinding = { name: 'example', severity: 'critical', title: 'Remote code execution', url: 'https://example.test/advisory/1', range: '<2', fixAvailable: false }
const report = (findings: AuditFinding[], critical = findings.filter(item => item.severity === 'critical').length): PackageAudit => ({ manager: 'npm', scannedAt: '', counts: { critical, high: 0, moderate: 0, low: 0, info: 0 }, findings })

describe('new critical vulnerabilities', () => {
  it('detects a first critical result and a severity escalation', () => {
    expect(newCriticalVulnerabilities(undefined, report([finding]))).toEqual({ findings: [finding], additionalCount: 0 })
    expect(newCriticalVulnerabilities(report([{ ...finding, severity: 'high' }]), report([finding])).findings).toEqual([finding])
    expect(newCriticalVulnerabilities(undefined, report([{ ...finding, severity: 'high' }])).findings).toEqual([])
  })

  it('detects a replacement advisory even if the total is unchanged or decreases', () => {
    const incoming = { ...finding, url: 'https://example.test/advisory/2', title: 'Another critical issue' }
    expect(newCriticalVulnerabilities(report([finding]), report([incoming])).findings).toEqual([incoming])
    expect(newCriticalVulnerabilities(report([finding, { ...finding, name: 'other' }]), report([incoming])).findings).toEqual([incoming])
  })

  it('ignores timestamps, ordering, ranges, fix availability, and duplicate findings', () => {
    const previous = report([{ ...finding, title: 'Issue B; Issue A' }])
    const changed = { ...finding, title: 'Issue A; Issue B', fixAvailable: true, range: '<3' }
    expect(newCriticalVulnerabilities(previous, { ...report([changed, changed], 1), scannedAt: 'later' })).toEqual({ findings: [], additionalCount: 0 })
    expect(newCriticalVulnerabilities(report([]), report([finding, finding], 1)).findings).toEqual([finding])
  })

  it('handles summary-only critical increases without repeating unchanged counts', () => {
    expect(newCriticalVulnerabilities(report([], 1), report([], 3))).toEqual({ findings: [], additionalCount: 2 })
    expect(newCriticalVulnerabilities(report([], 3), report([], 3))).toEqual({ findings: [], additionalCount: 0 })
    expect(newCriticalVulnerabilities(report([], 1), report([finding], 3))).toEqual({ findings: [finding], additionalCount: 1 })
  })

  it('alerts again after a successful clean report resolves an issue', () => {
    expect(newCriticalVulnerabilities(report([finding]), report([]))).toEqual({ findings: [], additionalCount: 0 })
    expect(newCriticalVulnerabilities(report([]), report([finding])).findings).toEqual([finding])
  })
})
