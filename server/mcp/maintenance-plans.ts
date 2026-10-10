import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { HelperApplication } from '../application'
import type { AuditFixRequest } from '../../src/types'
import { reportKinds } from '../../src/types'
import { preparePackageUpdate, applyPackageUpdate, type PreparedPackageUpdate } from '../package-update'
import { prepareAuditFix } from '../package-audit-fix'
import { measureProjectStorage, removeProjectNodeModules } from '../project-storage'
import { maintenancePreconditions } from '../maintenance-preconditions'
import { OperationResultFailure } from '../operations'
import { maintenanceKind, requireCapability, type Principal } from './policy'
import { maintenancePlan, maintenanceResult } from './schemas'
import { McpFailure } from './errors'
import { clean } from './output'

type Kind = z.infer<typeof maintenanceKind>
type Plan = z.infer<typeof maintenancePlan>
interface Stored { principal: string; plan: Plan; update?: PreparedPackageUpdate; consumed: boolean; bytes: number }

export class MaintenancePlans {
  private readonly plans = new Map<string, Stored>()
  constructor(private readonly application: HelperApplication, private readonly now = () => Date.now()) {}

  private prune() {
    for (const [id, record] of this.plans) if (Date.parse(record.plan.expiresAt) <= this.now()) this.plans.delete(id)
  }
  projectIds(principal: Principal, planId: string): string[] {
    this.prune()
    const record = this.plans.get(planId)
    return record?.principal === principal.id ? record.plan.affectedProjectIds : []
  }
  private get(principal: Principal, planId: string, kind: Kind) {
    this.prune()
    const record = this.plans.get(planId)
    if (!record || record.principal !== principal.id) throw new McpFailure('PLAN_EXPIRED', 'Plan not found or expired. Prepare a new plan.')
    if (record.consumed) throw new McpFailure('PRECONDITION_FAILED', 'This plan was already consumed. Inspect its prior operation; do not replay a mutation.')
    if (record.plan.kind !== kind) throw new McpFailure('INVALID_ARGUMENT', 'Use the apply tool matching this plan.')
    return record
  }
  private effects(principal: Principal, kind: Kind, apply: boolean) {
    requireCapability(principal, 'maintenance')
    if (kind !== 'dependency-cleanup') requireCapability(principal, 'network')
    if (apply && !principal.maintenanceAutomation?.includes(kind)) throw new McpFailure('CAPABILITY_DISABLED', 'Applying this kind of maintenance requires an explicit local maintenanceAutomation grant for this client and its roots.')
  }
  private async scope(principal: Principal, projectId: string) {
    await this.application.index.checkedEntry(principal, projectId, true)
    const entries = this.application.registry.related(projectId)
    for (const entry of entries) await this.application.index.checkedEntry(principal, entry.project.id, true)
    return entries
  }
  async prepare(principal: Principal, projectId: string, kind: Kind, level: 'minor' | 'patch' = 'patch', finding?: AuditFixRequest): Promise<Plan> {
    this.effects(principal, kind, false)
    this.application.index.entry(principal, projectId)
    return this.application.runtime.withMaintenance(projectId, async entry => {
      const entries = await this.scope(principal, projectId)
      const before = await maintenancePreconditions(entries, kind === 'dependency-cleanup' ? entry.directory : undefined)
      const update = kind === 'package-update' ? await preparePackageUpdate(entry, level)
        : kind === 'vulnerability-fix' ? await prepareAuditFix(entry, finding) : undefined
      const storage = kind === 'dependency-cleanup' ? await measureProjectStorage(entry.directory) : undefined
      const after = await maintenancePreconditions(await this.scope(principal, projectId), kind === 'dependency-cleanup' ? entry.directory : undefined)
      if (before.digest !== after.digest) throw new McpFailure('PRECONDITION_FAILED', 'Package inputs changed during preparation. Prepare again.')
      const plan = maintenancePlan.parse({
        planId: `plan_${randomUUID()}`, helperInstanceId: this.application.helperInstanceId, kind, projectId,
        affectedProjectIds: entries.map(member => member.project.id).sort(),
        createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + 10 * 60_000).toISOString(),
        level: update?.level, targets: update?.targets ?? [], skipped: update?.skipped ?? [],
        cleanup: storage ? { target: 'node_modules', identity: before.cleanupIdentity, allocatedBytes: storage.nodeModulesBytes, partial: storage.partial } : undefined,
        files: before.files, preconditions: before.digest, lifecycleScripts: false,
        impact: storage ? 'Remove only this project’s real root-level node_modules. Invalidate related reports and remeasure storage.' : 'Install these exact direct dependency versions with lifecycle scripts disabled. Package manifests, shared locks and installed/transitive dependencies may change throughout the package workspace. Invalidate related reports; no rollback or clean-audit guarantee.',
        approval: 'local-scoped-automation-required',
      })
      // A complete plan must fit a single result page; never silently truncate review data.
      if (Buffer.byteLength(JSON.stringify(clean(plan, principal))) > 12 * 1024 || plan.targets.length > 100) throw new McpFailure('RESOURCE_LIMIT', 'The complete maintenance plan exceeds the review limit.')
      this.prune()
      const bytes = Buffer.byteLength(JSON.stringify({ plan, update }))
      if (this.plans.size >= 100 || [...this.plans.values()].filter(record => record.principal === principal.id).length >= 10 || [...this.plans.values()].reduce((sum, record) => sum + record.bytes, bytes) > 32 * 1024 * 1024) throw new McpFailure('RESOURCE_LIMIT', 'Maintenance plan retention is full. Wait for plans to expire.')
      this.plans.set(plan.planId, { principal: principal.id, plan: structuredClone(plan), update: structuredClone(update), consumed: false, bytes })
      return plan
    })
  }

  async apply(principal: Principal, planId: string, kind: Kind) {
    this.effects(principal, kind, true)
    const record = this.get(principal, planId, kind)
    this.application.index.entry(principal, record.plan.projectId)
    return this.application.runtime.withMaintenance(record.plan.projectId, async (entry, markAttempted) => {
      const current = await maintenancePreconditions(await this.scope(principal, entry.project.id), kind === 'dependency-cleanup' ? entry.directory : undefined)
      this.effects(principal, kind, true)
      this.get(principal, planId, kind) // Expiry and single use checked again under reservation.
      if (current.digest !== record.plan.preconditions) throw new McpFailure('PRECONDITION_FAILED', 'The reviewed files or directory identities changed. Prepare a new plan.')
      record.consumed = true
      const result: z.infer<typeof maintenanceResult> = {
        kind: 'maintenance', planId, projectId: entry.project.id, status: 'succeeded', attempted: [], completed: [],
        cleanupAttempted: false, invalidatedReports: [], unknowns: [], followUpAudit: 'not-run',
      }
      const attempt = () => {
        markAttempted()
        result.invalidatedReports = record.plan.affectedProjectIds.map(projectId => ({ projectId, kinds: reportKinds.filter(kind => kind !== 'remoteActivity') }))
      }
      try {
        if (record.update) {
          entry.project.packageUpdate = await applyPackageUpdate(entry, record.update, undefined, (group, completed) => {
            if (completed) result.completed.push(...group)
            else { attempt(); result.attempted.push(...group) }
          })
          if (result.attempted.length) result.unknowns.push('Installed transitive dependency state and vulnerability status have not been rechecked.')
        } else {
          attempt()
          result.cleanupAttempted = true
          const [dev, ino] = record.plan.cleanup!.identity.split(':')
          result.storage = await removeProjectNodeModules(entry.directory, { dev, ino })
        }
      } catch {
        result.status = 'failed'
        result.unknowns.push('Files may have partially changed. No rollback was attempted. Refresh disk usage and package reports before preparing another plan.')
        throw new OperationResultFailure([maintenanceResult.parse(result)])
      }
      return maintenanceResult.parse(result)
    })
  }
}
