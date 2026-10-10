import valid from 'semver/functions/valid'
import validRange from 'semver/ranges/valid'
import type { AuditFinding, AuditFixRequest, ProjectDependency, RepoProject } from '../types'

const packageName = /^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9_~][a-zA-Z0-9._~-]*$/
const simpleVersion = /^[~^]?(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){0,2}$/
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Identifies an existing declaration; the helper rechecks the compatible fix before installing. */
export function auditFixDependency(project: Pick<RepoProject, 'dependencies'>, finding: AuditFinding): ProjectDependency | undefined {
  if (finding.fixAvailable !== true || finding.suppression || (finding.direct === false && !finding.fixTarget)) return undefined
  const name = finding.fixTarget?.name ?? finding.name
  if (!packageName.test(name)) return undefined
  const declarations = project.dependencies?.filter(dependency => dependency.name === name) ?? []
  if (declarations.length !== 1) return undefined
  const dependency = declarations[0]
  if (dependency.kind === 'peerDependencies' || !simpleVersion.test(dependency.version) || !validRange(dependency.version)) return undefined
  if (name === finding.name) {
    if (!finding.range?.trim() || !validRange(finding.range)) return undefined
  } else if (!finding.fixTarget || !stableVersion.test(finding.fixTarget.version) || !valid(finding.fixTarget.version)) return undefined
  return dependency
}

/** Requests identify an audited finding, never a client-supplied install command or version. */
export function auditFixRequest(finding: AuditFinding): AuditFixRequest {
  return {
    name: finding.name, title: finding.title,
    ...(finding.range !== undefined ? { range: finding.range } : {}),
    ...(finding.url !== undefined ? { url: finding.url } : {}),
  }
}
