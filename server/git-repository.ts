import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { RepositoryGitCoverage, RepositoryGitDay, RepositoryGitHistory, RepositoryGitPushStatus, RepositoryGitScope } from '../src/types'
import type { HelperApplication, RootSnapshot } from './application'
import { gitOptions, gitReadEnvironment, readGitHistory } from './git-history'
import { readGitDay } from './git-daily-summary'
import { readGitPushStatus } from './git-push-status'
import { HelperError, isWithin, type RegisteredProject } from './scanner'

const exec = promisify(execFile)
const scopeSchema = z.object({
  rootId: z.string().regex(/^root_[a-f0-9]{20}$/),
  repositoryId: z.string().min(1).max(100),
  projectIds: z.array(z.string().regex(/^[a-f0-9]{20}$/)).min(1).max(300),
})

export interface RepositoryCheckout {
  entry: RegisteredProject
  error?: string
}

/** Only current root members select checkouts. Requests cannot supply paths or tips. */
export async function repositoryGitEntries(application: HelperApplication, anchorId: string, input: unknown): Promise<{ scope: RepositoryGitScope; checkouts: RepositoryCheckout[]; root: RootSnapshot }> {
  const parsed = scopeSchema.safeParse(input)
  if (!parsed.success) throw new HelperError('Choose a valid repository and its current projects.')
  const scope = parsed.data
  const root = application.roots.get(scope.rootId)
  if (!root) throw new HelperError('Sync this folder before reading its repository.', 404)
  if (!scope.projectIds.includes(anchorId)) throw new HelperError('Include the selected project in this repository request.')
  const selected = new Map<string, RegisteredProject>()
  for (const id of new Set(scope.projectIds)) {
    if (!root.members.get(id)?.observed) throw new HelperError('A project is no longer a current member of this folder. Sync again.', 409)
    const entry = application.registry.lookup(id)
    const context = entry.project.gitContext
    if (context?.state !== 'verified' || context.repositoryId !== scope.repositoryId || !entry.gitIdentity || !isWithin(root.directory, entry.directory) || !isWithin(root.directory, entry.gitIdentity.checkoutDirectory)) {
      throw new HelperError('A project no longer belongs to this repository. Sync again.', 409)
    }
    if (!selected.has(context.worktreeId)) selected.set(context.worktreeId, { ...entry, root: root.directory })
  }
  const checkouts: RepositoryCheckout[] = []
  const deadline = Date.now() + 50_000
  // Bound concurrent subprocesses independently of the number of package projects.
  for (const entry of selected.values()) {
    try {
      if (Date.now() >= deadline) throw new Error('Git scope validation timed out.')
      await application.registry.get(entry.project.id)
      checkouts.push({ entry })
    } catch {
      checkouts.push({ entry, error: 'This checkout is unavailable or its Git identity changed. Sync the folder.' })
    }
  }
  checkRepositorySnapshot(application, root)
  return { scope, checkouts, root }
}

export function checkRepositorySnapshot(application: HelperApplication, root: RootSnapshot) {
  if (application.roots.get(root.id) !== root) throw new HelperError('The folder was scanned while Git activity was being read. Try again.', 409)
}

async function git(entry: RegisteredProject, args: string[], signal?: AbortSignal) {
  return (await exec('git', [...gitOptions, ...args], {
    cwd: entry.gitIdentity?.checkoutDirectory ?? entry.gitDirectory ?? entry.directory,
    timeout: 10_000, maxBuffer: 4 * 1024 * 1024, env: gitReadEnvironment(), signal,
  })).stdout.replace(/\n$/, '')
}

async function checkoutHead(entry: RegisteredProject, signal: AbortSignal): Promise<string | undefined> {
  try {
    const head = await git(entry, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal)
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Invalid HEAD')
    return head
  } catch (error) {
    // An unborn branch has no tip. Other failures must not become an empty result.
    if ((error as { code?: number }).code !== 1) throw error
    const branch = await git(entry, ['symbolic-ref', '--quiet', 'HEAD'], signal)
    if (!branch.startsWith('refs/heads/')) throw error
    try { await git(entry, ['show-ref', '--verify', '--quiet', branch], signal) }
    catch (missing) { if ((missing as { code?: number }).code === 1) return undefined }
    throw error
  }
}

async function prepare(repositoryId: string, checkouts: RepositoryCheckout[]) {
  const heads = new Set<string>()
  const valid: RegisteredProject[] = []
  const failures = new Map<string, string>()
  const signal = AbortSignal.timeout(50_000)
  for (const checkout of checkouts) {
    const { entry } = checkout
    try {
      if (checkout.error) throw new Error(checkout.error)
      const head = await checkoutHead(entry, signal)
      if (head) heads.add(head)
      valid.push(entry)
    } catch { failures.set(entry.project.id, 'The checkout HEAD could not be read. Sync the folder and try again.') }
  }
  if (!valid.length) throw new HelperError('No eligible checkout could be read. Sync the folder and try again.', 422)
  const coverage: RepositoryGitCoverage = { repositoryId, coverage: failures.size ? 'partial' : 'complete' }
  if (failures.size) coverage.warnings = ['Some selected checkouts could not be read; their detached commits may be missing.']
  return { entry: valid[0], heads: [...heads], failures, coverage }
}

export async function readRepositoryGitHistory(repositoryId: string, checkouts: RepositoryCheckout[], input: Record<string, unknown>, now = new Date()): Promise<RepositoryGitHistory> {
  const scope = await prepare(repositoryId, checkouts)
  const result = await readGitHistory(scope.entry, input, now, { heads: scope.heads })
  return { ...result, ...scope.coverage, coverage: !result.available || result.shallow ? 'partial' : scope.coverage.coverage }
}

export async function readRepositoryGitDay(repositoryId: string, checkouts: RepositoryCheckout[], input: Record<string, unknown>): Promise<RepositoryGitDay> {
  const scope = await prepare(repositoryId, checkouts)
  const result = await readGitDay(scope.entry, input, { heads: scope.heads })
  return { ...result, ...scope.coverage, coverage: !result.available || result.shallow ? 'partial' : scope.coverage.coverage }
}

export async function readRepositoryGitPushStatus(repositoryId: string, checkouts: RepositoryCheckout[]): Promise<RepositoryGitPushStatus> {
  const scope = await prepare(repositoryId, checkouts)
  const result = await readGitPushStatus(scope.entry, { heads: scope.heads })
  const rows: RepositoryGitPushStatus['checkouts'] = []
  const signal = AbortSignal.timeout(30_000)
  if (!result.hasOrigin) result.shallow = await git(scope.entry, ['rev-parse', '--is-shallow-repository'], signal) === 'true'
  for (const { entry } of checkouts) {
    const context = entry.project.gitContext
    if (context?.state !== 'verified') continue
    const row: RepositoryGitPushStatus['checkouts'][number] = { worktreeId: context.worktreeId, projectId: entry.project.id, path: path.relative(entry.root, entry.gitIdentity!.checkoutDirectory) || '.' }
    row.error = scope.failures.get(entry.project.id)
    if (!row.error) {
      try { row.dirty = !!(await git(entry, ['status', '--porcelain', '--untracked-files=normal'], signal)) }
      catch { row.error = 'Working changes could not be read.' }
    }
    rows.push(row)
  }
  const partial = scope.coverage.coverage === 'partial' || rows.some(row => row.error) || !result.available || result.shallow
  return { ...result, ...scope.coverage, coverage: partial ? 'partial' : 'complete', dirty: rows.some(row => row.dirty), checkouts: rows, ...(rows.some(row => row.error) ? { warnings: [...scope.coverage.warnings ?? [], 'Working changes are unavailable for some selected checkouts.'] } : {}) }
}
