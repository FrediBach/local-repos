import { describe, expect, it } from 'vitest'
import { projectTodos } from './project-todos'
import type { AuditFinding, PackageAudit, ReactDoctorFinding, RepoProject } from '@/types'

const project: RepoProject = { id: 'app', name: 'App', dirName: 'app', relativePath: 'app', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' }
const high: AuditFinding = { name: 'unsafe', severity: 'high', title: 'Unsafe input', url: 'https://example.test/advisory' }
const audit = (findings: AuditFinding[]): PackageAudit => ({ manager: 'npm', scannedAt: '2026-10-09', findings, counts: { info: 0, low: 0, moderate: 0, high: findings.filter(finding => finding.severity === 'high').length, critical: findings.filter(finding => finding.severity === 'critical').length } })
const error: ReactDoctorFinding = { filePath: 'src/App.tsx', line: 12, column: 3, plugin: 'react', rule: 'hooks', severity: 'error', message: 'Conditional hook', help: 'Move hook', category: 'React' }

describe('important project todos', () => {
  it('groups all important scans into three tasks and prioritizes critical vulnerabilities', () => {
    const todos = projectTodos([{ ...project, audit: audit([high, { ...high, name: 'critical-package', severity: 'critical' }]),
      outdated: { manager: 'npm', scannedAt: 'outdated scan', level: 'high', score: 100, findings: [{ name: 'old', current: '1.0.0', latest: '11.0.0', change: 'major', majorGap: 10, score: 100 }] },
      reactDoctor: { version: '1', scannedAt: 'doctor scan', score: 60, label: '', findings: [error, { ...error, severity: 'warning' }] },
    }])
    expect(todos).toHaveLength(3)
    expect(todos.map(todo => [todo.kind, todo.priority, todo.tab])).toEqual([
      ['security', 'critical', 'packages'], ['outdated', 'high', 'packages'], ['react-doctor', 'high', 'react-doctor'],
    ])
    expect(todos[0].description).toContain('1 critical vulnerability and 1 high-severity vulnerability')
    expect(todos[1].scannedAt).toBe('outdated scan')
    expect(todos[2].description).toContain('1 error across 1 file')
  })

  it('excludes warnings, low scores, ordinary updates, unused packages and storage', () => {
    expect(projectTodos([{ ...project, audit: audit([{ ...high, severity: 'moderate' }]),
      outdated: { manager: 'npm', scannedAt: '', level: 'moderate', score: 30, findings: [{ name: 'old', current: '1', latest: '2', change: 'major', majorGap: 1, score: 30 }] },
      reactDoctor: { version: '1', scannedAt: '', score: 1, label: 'Poor', findings: [{ ...error, severity: 'warning' }] },
      unused: { scannedAt: '', knipVersion: '1', findings: [{ name: 'unused', kind: 'dependencies', version: '1' }] },
      storage: { totalBytes: 10000000000, nodeModulesBytes: 10000000000, hasNodeModules: true, measuredAt: '', partial: false },
    }])).toEqual([])
  })

  it('supports count-only audit reports with stable subsets and severity-specific identities', () => {
    const report = audit([])
    report.counts.high = 3
    const original = projectTodos([{ ...project, audit: report }])[0]
    expect(original.findingKeys).toHaveLength(3)
    const smaller = projectTodos([{ ...project, audit: { ...report, counts: { ...report.counts, high: 2 }, scannedAt: 'later' } }])[0]
    expect(smaller.findingKeys.every(key => original.findingKeys.includes(key))).toBe(true)
    expect(projectTodos([{ ...project, audit: { ...report, counts: { ...report.counts, high: 0, critical: 1 } } }])[0].findingKeys[0]).not.toBe(original.findingKeys[0])
  })

  it('ignores audit ordering, range changes and timestamps but detects new advisories and severity escalation', () => {
    const second = { ...high, name: 'other', title: 'A; B' }
    const original = projectTodos([{ ...project, audit: audit([high, second]) }])[0]
    const rescanned = projectTodos([{ ...project, audit: { ...audit([{ ...second, title: 'B; A', range: '<3', fixAvailable: true }, high]), scannedAt: 'later' } }])[0]
    expect(rescanned.findingKeys).toEqual(original.findingKeys)
    const escalated = projectTodos([{ ...project, audit: audit([{ ...high, severity: 'critical' }]) }])[0]
    expect(original.findingKeys).not.toContain(escalated.findingKeys[0])
    const newFinding = projectTodos([{ ...project, audit: audit([{ ...high, title: 'A different advisory' }]) }])[0]
    expect(original.findingKeys).not.toContain(newFinding.findingKeys[0])
  })

  it('preserves React Doctor identities through line shifts but notices an additional occurrence', () => {
    const doctor = { version: '1', scannedAt: '', score: 70, label: '', findings: [error, { ...error, line: 99 }] }
    const original = projectTodos([{ ...project, reactDoctor: doctor }])[0]
    const shifted = projectTodos([{ ...project, reactDoctor: { ...doctor, findings: [{ ...error, line: 100 }, { ...error, line: 13 }] } }])[0]
    expect(shifted.findingKeys).toEqual(original.findingKeys)
    const extra = projectTodos([{ ...project, reactDoctor: { ...doctor, findings: [...doctor.findings, { ...error, line: 150 }] } }])[0]
    expect(extra.findingKeys).toHaveLength(3)
    expect(original.findingKeys.every(key => extra.findingKeys.includes(key))).toBe(true)
  })
})

it('does not create security todos for suppressed high or critical findings', () => {
  const report = audit([high, { ...high, severity: 'critical' }].map(finding => ({ ...finding, suppression: { source: '.trivyignore', ids: ['CVE-2026-12345'] } })))
  report.counts.high = 0
  report.counts.critical = 0
  expect(projectTodos([{ id: 'suppressed', audit: report } as RepoProject])).toEqual([])
})
