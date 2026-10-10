import { satisfies, validRange } from 'semver'
import type { AuditFinding, AuditFixRequest, PackageUpdate } from '../src/types'
import { auditFixDependency } from '../src/lib/audit-fix'
import { auditProject, type AuditRunner } from './package-audit'
import { packageFingerprint, repositoryFingerprint } from './package-fingerprint'
import { readProjectManifest, type OutdatedRunner } from './package-outdated'
import { applyPackageUpdate, preparePackageUpdate, type PreparedPackageUpdate } from './package-update'
import { HelperError, type RegisteredProject } from './scanner'

const packageName = /^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9_~][a-zA-Z0-9._~-]*$/

export function validateAuditFixRequest(value: unknown): AuditFixRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HelperError('Choose a vulnerability to fix.', 400)
  const request = value as Record<string, unknown>
  if (typeof request.name !== 'string' || request.name.length > 214 || !packageName.test(request.name)
    || typeof request.title !== 'string' || !request.title.trim() || request.title.length > 8_000
    || (request.range !== undefined && (typeof request.range !== 'string' || request.range.length > 2_000))
    || (request.url !== undefined && (typeof request.url !== 'string' || request.url.length > 2_000))) {
    throw new HelperError('Choose a valid vulnerability from the audit report.', 400)
  }
  return { name: request.name, title: request.title, ...(request.range === undefined ? {} : { range: request.range as string }), ...(request.url === undefined ? {} : { url: request.url as string }) }
}

function matches(finding: AuditFinding, request: AuditFixRequest) {
  return finding.name === request.name && finding.title === request.title && finding.range === request.range && finding.url === request.url
}

async function fingerprint(entry: RegisteredProject) {
  return repositoryFingerprint(await packageFingerprint(entry.directory), entry.workspaceDirectory ? await packageFingerprint(entry.workspaceDirectory) : undefined)
}

/** Fix one freshly verified finding without adding dependencies or crossing a major version. */
export async function prepareAuditFix(entry: RegisteredProject, value: unknown, runner?: OutdatedRunner, auditRunner?: AuditRunner): Promise<PreparedPackageUpdate> {
  const request = validateAuditFixRequest(value)
  const baseline = await fingerprint(entry)
  const { dependencies } = await readProjectManifest(entry)
  const audit = await auditProject(entry, auditRunner)
  const finding = audit.findings.find(item => matches(item, request) && !item.suppression)
  if (!finding?.fixAvailable) throw new HelperError('This finding changed or no longer has a reported fix. Scan for vulnerabilities again before retrying.', 409)
  const dependency = auditFixDependency({ dependencies: [...dependencies.values()] }, finding)
  if (!dependency) throw new HelperError('This finding needs a manual dependency update. Automatic fixes only update an unambiguous declared dependency.', 409)

  const affected = audit.findings.filter(item => item.name === dependency.name && !item.suppression)
  // A registry's incomplete range cannot establish that an arbitrary version is safe.
  if (!affected.length || affected.some(item => !item.range?.trim() || !validRange(item.range) || (item.patchedRange !== undefined && !validRange(item.patchedRange)))) {
    throw new HelperError('The audit does not identify a reliable fixed version range. Review this dependency manually.', 409)
  }
  const parentFix = dependency.name !== finding.name ? finding.fixTarget : undefined
  const result = await preparePackageUpdate(entry, 'minor', runner, {
    name: dependency.name,
    acceptsCurrent: current => parentFix ? affected.some(item => satisfies(current, item.range!)) : satisfies(current, finding.range!),
    accepts: version => (!parentFix || version === parentFix.version)
      && affected.every(item => !satisfies(version, item.range!) && (!item.patchedRange || satisfies(version, item.patchedRange))),
    beforeInstall: async () => {
      if (await fingerprint(entry) !== baseline) throw new HelperError('Package files or ignore rules changed during the fix check. Rescan and try again.', 409)
    },
  })
  if (!result.targets.length) throw new HelperError(`No compatible minor or patch fix is available for ${dependency.name}. ${result.skipped.find(item => item.name === dependency.name)?.reason ?? 'A major upgrade or manual dependency update may be required.'} No packages were installed.`, 409)
  return result
}

export async function fixAuditFinding(entry: RegisteredProject, value: unknown, runner?: OutdatedRunner, auditRunner?: AuditRunner): Promise<PackageUpdate> {
  return applyPackageUpdate(entry, await prepareAuditFix(entry, value, runner, auditRunner), runner)
}
