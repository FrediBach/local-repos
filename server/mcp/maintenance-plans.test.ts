import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename, symlink, stat, utimes } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HelperApplication } from '../application'
import * as updates from '../package-update'
import { MaintenancePlans } from './maintenance-plans'
import { rootId, type Principal } from './policy'
import { OperationResultFailure } from '../operations'
import { maintenancePreconditions } from '../maintenance-preconditions'

let root: string, directory: string, app: HelperApplication, principal: Principal, id: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-plans-')))
  directory = path.join(root, 'demo')
  await mkdir(directory)
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { alpha: '^1.0.0' } }))
  app = new HelperApplication()
  const scan = await app.scan(root)
  id = scan.projects[0].id
  principal = { id: 'test', roots: [{ id: rootId(root), directory: root, name: 'projects' }], capabilities: ['read', 'maintenance', 'network'], maintenanceAutomation: ['package-update', 'vulnerability-fix', 'dependency-cleanup'], discloseContent: false, disclosePaths: false }
  vi.spyOn(updates, 'preparePackageUpdate').mockImplementation(async entry => ({ level: 'patch', original: await readFile(path.join(entry.directory, 'package.json'), 'utf8'), manager: 'npm', yarnMajor: 1, targets: [{ name: 'alpha', from: '1.0.0', to: '1.0.1', kind: 'dependencies' }], skipped: [] }))
})
afterEach(async () => { vi.restoreAllMocks(); await app.shutdown(); await rm(root, { recursive: true, force: true }) })

it('prepares without applying, isolates stored targets, and consumes a plan only once', async () => {
  const apply = vi.spyOn(updates, 'applyPackageUpdate').mockImplementation(async (_entry, plan, _runner, progress) => {
    progress?.(plan.targets, false); progress?.(plan.targets, true)
    return { level: plan.level, updatedAt: '', packages: plan.targets, skipped: [] }
  })
  const plan = await app.maintenancePlans.prepare(principal, id, 'package-update')
  expect(apply).not.toHaveBeenCalled()
  expect(plan.targets[0].to).toBe('1.0.1')
  plan.targets[0].to = '9.0.0'
  const result = await app.maintenancePlans.apply(principal, plan.planId, 'package-update')
  expect(result.completed[0].to).toBe('1.0.1')
  expect(result.invalidatedReports[0].kinds).toHaveLength(6)
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  expect(apply).toHaveBeenCalledTimes(1)
})

it('requires a separate automation grant and binds plans to the preparing principal and kind', async () => {
  const plan = await app.maintenancePlans.prepare(principal, id, 'package-update')
  await expect(app.maintenancePlans.apply({ ...principal, maintenanceAutomation: [] }, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
  await expect(app.maintenancePlans.apply({ ...principal, id: 'other' }, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PLAN_EXPIRED' })
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'vulnerability-fix')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  await expect(app.maintenancePlans.prepare({ ...principal, capabilities: ['maintenance'] }, id, 'package-update')).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
})

it('expires plans after ten minutes and cannot resume them in another helper', async () => {
  let now = Date.now()
  const plans = new MaintenancePlans(app, () => now)
  const plan = await plans.prepare(principal, id, 'package-update')
  now += 600_000
  await expect(plans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PLAN_EXPIRED' })
  await expect(new MaintenancePlans(app).apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PLAN_EXPIRED' })
})

it.each(['package.json', 'package-lock.json', '.npmrc', '.trivyignore'])('rejects changed %s contents even when size and mtime match', async filename => {
  const file = path.join(directory, filename)
  const original = filename === 'package.json' ? await readFile(file, 'utf8') : 'alpha'
  await writeFile(file, original)
  const info = await stat(file)
  const plan = await app.maintenancePlans.prepare(principal, id, 'package-update')
  await writeFile(file, original.replace('alpha', 'bravo'))
  await utimes(file, info.atime, info.mtime)
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  expect(app.index.invalidationCount).toBe(0)
})

it('rejects package symlinks and new or replaced directory identities', async () => {
  const plan = await app.maintenancePlans.prepare(principal, id, 'package-update')
  await rename(directory, `${directory}-old`)
  await mkdir(directory)
  await writeFile(path.join(directory, 'package.json'), await readFile(path.join(`${directory}-old`, 'package.json')))
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  await symlink(path.join(`${directory}-old`, 'package.json'), path.join(directory, '.npmrc'))
  await expect(maintenancePreconditions(app.registry.related(id))).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

it('reserves maintenance before filesystem awaits and preserves failed mutation results and tombstones', async () => {
  const plan = await app.maintenancePlans.prepare(principal, id, 'package-update')
  vi.spyOn(updates, 'applyPackageUpdate').mockImplementation(async (_entry, prepared, _runner, progress) => {
    progress?.(prepared.targets, false)
    await writeFile(path.join(directory, 'package-lock.json'), 'partial install')
    throw new Error('registry failure')
  })
  const promise = app.maintenancePlans.apply(principal, plan.planId, 'package-update')
  expect(() => app.runtime.reserveMetadataScan()).toThrow()
  await expect(app.runtime.storage(id)).rejects.toThrow()
  let error: unknown
  try { await promise } catch (value) { error = value }
  expect(error).toBeInstanceOf(OperationResultFailure)
  expect((error as OperationResultFailure).result).toMatchObject([{ status: 'failed', attempted: [{ name: 'alpha' }], completed: [], invalidatedReports: [{ projectId: id }] }])
  expect(app.index.reportSummary(app.registry.lookup(id).project, 'audit').availability).toBe('invalidated')
  expect(app.runtime.scopeBusy(id)).toBe(false)
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

it('prepares and deletes only the selected real node_modules, then returns fresh measurement', async () => {
  const modules = path.join(directory, 'node_modules')
  await mkdir(modules)
  await writeFile(path.join(modules, 'dependency'), 'data')
  const plan = await app.maintenancePlans.prepare(principal, id, 'dependency-cleanup')
  expect(await readFile(path.join(modules, 'dependency'), 'utf8')).toBe('data')
  expect(plan.cleanup).toMatchObject({ target: 'node_modules', partial: false })
  const result = await app.maintenancePlans.apply(principal, plan.planId, 'dependency-cleanup')
  expect(result.storage?.hasNodeModules).toBe(false)
  expect(result.cleanupAttempted).toBe(true)
  expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toContain('alpha')
})

it('rejects a replaced cleanup directory and never follows a node_modules symlink', async () => {
  const modules = path.join(directory, 'node_modules')
  await mkdir(modules)
  const plan = await app.maintenancePlans.prepare(principal, id, 'dependency-cleanup')
  await rename(modules, path.join(directory, 'saved'))
  await mkdir(modules)
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'dependency-cleanup')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  await rm(modules, { recursive: true })
  await symlink(path.join(directory, 'saved'), modules)
  await expect(app.maintenancePlans.prepare(principal, id, 'dependency-cleanup')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

it('rejects nested grants lacking effective workspace authority and invalidates all authorized related packages', async () => {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'workspace', workspaces: ['packages/*'] }))
  const member = path.join(directory, 'packages', 'one')
  await mkdir(member, { recursive: true })
  await writeFile(path.join(member, 'package.json'), JSON.stringify({ name: 'one', dependencies: { alpha: '^1.0.0' } }))
  const scan = await app.scan(root)
  const memberId = scan.projects.find(project => project.name === 'one')!.id
  await app.scan(member)
  const nested = { ...principal, roots: [{ id: rootId(member), directory: member, name: 'one' }] }
  await expect(app.maintenancePlans.prepare(nested, memberId, 'package-update')).rejects.toThrow()
  const plan = await app.maintenancePlans.prepare(principal, memberId, 'package-update')
  expect(plan.affectedProjectIds.sort()).toEqual([id, memberId].sort())
  await writeFile(path.join(directory, 'package-lock.json'), 'changed parent')
  await expect(app.maintenancePlans.apply(principal, plan.planId, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

it('hashes file boundaries unambiguously even when file content contains another input label', async () => {
  const manifest = path.join(directory, 'package.json'), lock = path.join(directory, 'package-lock.json')
  const label = JSON.stringify([directory, 'package-lock.json'])
  await writeFile(manifest, 'x')
  await writeFile(lock, `y${label}z`)
  const before = await maintenancePreconditions(app.registry.related(id))
  await writeFile(manifest, `x${label}y`)
  await writeFile(lock, 'z')
  const after = await maintenancePreconditions(app.registry.related(id))
  expect(after.digest).not.toBe(before.digest)
})

it('rejects metadata changes during preparation and releases its reservation', async () => {
  vi.mocked(updates.preparePackageUpdate).mockImplementation(async entry => {
    const original = await readFile(path.join(entry.directory, 'package.json'), 'utf8')
    await writeFile(path.join(directory, '.npmrc'), 'ignore-scripts=true')
    return { level: 'patch', original, manager: 'npm', yarnMajor: 1, targets: [], skipped: [] }
  })
  await expect(app.maintenancePlans.prepare(principal, id, 'package-update')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  expect(app.runtime.scopeBusy(id)).toBe(false)
})

it('waits for reserved preparation during shutdown and rejects new maintenance', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(updates.preparePackageUpdate).mockImplementation(async entry => {
    entered()
    await pending
    return { level: 'patch', original: await readFile(path.join(entry.directory, 'package.json'), 'utf8'), manager: 'npm', yarnMajor: 1, targets: [], skipped: [] }
  })
  const preparing = app.maintenancePlans.prepare(principal, id, 'package-update')
  await started
  let stopped = false
  const shutdown = app.shutdown().then(() => { stopped = true })
  await Promise.resolve()
  expect(stopped).toBe(false)
  await expect(app.maintenancePlans.prepare(principal, id, 'package-update')).rejects.toThrow()
  release()
  await preparing
  await shutdown
  expect(stopped).toBe(true)
})

it('bounds plan retention per principal rather than evicting active review data', async () => {
  for (let i = 0; i < 10; i++) await app.maintenancePlans.prepare(principal, id, 'package-update')
  await expect(app.maintenancePlans.prepare(principal, id, 'package-update')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' })
})
