import { describe, expect, it } from 'vitest'
import type { AuditFinding, ProjectDependency } from '../types'
import { auditFixDependency, auditFixRequest } from './audit-fix'

const dependency: ProjectDependency = { name: '@scope/package', version: '^1.2.3', kind: 'dependencies' }
const finding: AuditFinding = { name: dependency.name, title: 'Unsafe parsing', severity: 'high', range: '<1.2.4', fixAvailable: true }
const project = { dependencies: [dependency] }

describe('audit fix eligibility', () => {
  it.each(['1', '1.2', '1.2.3', '^1.2.3', '~1.2.3', '^0.2.1'])('accepts the existing direct registry declaration %s', version => {
    const declared = { ...dependency, version }
    expect(auditFixDependency({ dependencies: [declared] }, finding)).toBe(declared)
  })

  it.each(['dependencies', 'devDependencies', 'optionalDependencies'] as const)('preserves the %s dependency section', kind => {
    const declared = { ...dependency, kind }
    expect(auditFixDependency({ dependencies: [declared] }, finding)).toBe(declared)
  })

  it('uses an explicit direct parent remediation instead of introducing the transitive package', () => {
    const transitive: AuditFinding = { ...finding, name: 'nested-package', direct: false, range: undefined, fixTarget: { name: dependency.name, version: '1.2.4', isSemVerMajor: false } }
    expect(auditFixDependency(project, transitive)).toBe(dependency)
    expect(auditFixDependency(project, { ...transitive, fixTarget: undefined })).toBeUndefined()
    expect(auditFixDependency(project, { ...transitive, fixTarget: { name: 'another-parent', version: '1.2.4' } })).toBeUndefined()
  })

  it('does not treat a same-name declaration as proof for an explicitly transitive finding', () => {
    expect(auditFixDependency(project, { ...finding, direct: false })).toBeUndefined()
  })

  it('does not infer missing cached data, a published fix, or suppression eligibility', () => {
    expect(auditFixDependency({}, finding)).toBeUndefined()
    expect(auditFixDependency(project, { ...finding, fixAvailable: undefined })).toBeUndefined()
    expect(auditFixDependency(project, { ...finding, fixAvailable: false })).toBeUndefined()
    expect(auditFixDependency(project, { ...finding, suppression: { source: '.trivyignore', ids: ['CVE-2026-12345'] } })).toBeUndefined()
    expect(auditFixDependency(project, { ...finding, range: undefined })).toBeUndefined()
  })

  it('rejects peer-only and duplicated dependency declarations', () => {
    const peer = { ...dependency, kind: 'peerDependencies' as const }
    expect(auditFixDependency({ dependencies: [peer] }, finding)).toBeUndefined()
    expect(auditFixDependency({ dependencies: [dependency, peer] }, finding)).toBeUndefined()
    expect(auditFixDependency({ dependencies: [dependency, { ...dependency, kind: 'devDependencies' }] }, finding)).toBeUndefined()
  })

  it.each(['workspace:*', 'catalog:', 'file:../package', 'npm:other@1.2.3', 'git+https://example.com/package', 'latest', '*', '>=1 <2', '^1 || ^2', '1.2.3-beta.1', '1.2.3+build', '01.2.3'])('rejects unsupported declarations %s', version => {
    expect(auditFixDependency({ dependencies: [{ ...dependency, version }] }, finding)).toBeUndefined()
  })

  it.each(['', ' ', 'unknown', '>='])('requires a meaningful vulnerable range for same-name fixes (%s)', range => {
    expect(auditFixDependency(project, { ...finding, range })).toBeUndefined()
    expect(auditFixDependency(project, { ...finding, range, fixTarget: { name: dependency.name, version: '1.2.4' } })).toBeUndefined()
  })

  it.each(['latest', '^1.2.4', '1.2', '1.2.4-beta.1', '1.2.4+build', '01.2.4'])('rejects nonstable or nonexact parent targets %s', version => {
    expect(auditFixDependency(project, { ...finding, name: 'nested-package', direct: false, fixTarget: { name: dependency.name, version } })).toBeUndefined()
  })

  it('rejects unsafe dependency names even in cached metadata', () => {
    const unsafe = { ...dependency, name: '--global' }
    expect(auditFixDependency({ dependencies: [unsafe] }, { ...finding, name: unsafe.name })).toBeUndefined()
  })
})

describe('audit fix requests', () => {
  it('sends only the original finding identity, never install instructions or cached fix metadata', () => {
    const request = auditFixRequest({ ...finding, url: 'https://example.com/advisory', patchedRange: '>=1.2.4', fixTarget: { name: dependency.name, version: '1.2.4' } })
    expect(request).toEqual({ name: finding.name, title: finding.title, range: finding.range, url: 'https://example.com/advisory' })
    expect(auditFixRequest({ name: 'package', title: 'Issue', severity: 'low' })).toEqual({ name: 'package', title: 'Issue' })
  })
})
