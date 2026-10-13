import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { gitOptions, gitReadEnvironment, readGitHistory } from '../git-history'
import { readGitDay } from '../git-daily-summary'
import { readRepositoryGitDay, type RepositoryCheckout } from '../git-repository'
import { isWithin, type RegisteredProject } from '../scanner'
import type { ProjectIndex } from '../project-index'
import type { Principal } from './policy'
import { McpFailure } from './errors'
import { digest } from './output'

const exec = promisify(execFile)
async function git(entry: RegisteredProject, args: string[]) {
  return (await exec('git', [...gitOptions, ...args], { cwd: entry.gitDirectory ?? entry.workspaceDirectory ?? entry.directory, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, env: gitReadEnvironment() })).stdout.replace(/\n$/, '')
}
export async function gitRoot(entry: RegisteredProject): Promise<string | undefined> {
  try {
    const directory = await realpath(await git(entry, ['rev-parse', '--show-toplevel']))
    if (!isWithin(entry.root, directory)) throw new McpFailure('ROOT_NOT_ALLOWED', 'The effective Git repository is outside your root grant.')
    return directory
  } catch (error) {
    if (/not a git repository/i.test(String((error as { stderr?: string }).stderr))) return undefined
    throw error
  }
}
async function refs(entry: RegisteredProject) {
  return digest(await Promise.all([git(entry, ['for-each-ref', '--format=%(refname)%00%(objectname)']), git(entry, ['rev-parse', '--verify', 'HEAD']).catch(() => '')]))
}
export class GitReads {
  private readonly cache = new Map<string, { at: number; refs: string; result: Awaited<ReturnType<typeof readGitHistory>> }>()
  constructor(private readonly index: ProjectIndex) {}
  async history(principal: Principal, query: { projectId: string; branch?: string; authorEmail?: string; section?: 'commits' | 'branches' | 'authors' | 'activity'; cursor?: string }) {
    const entry = await this.index.checkedEntry(principal, query.projectId, true)
    const repository = await gitRoot(entry)
    const snapshot = repository ? await refs(entry) : 'no-repository'
    const section = query.section ?? 'commits'
    const binding = [principal.id, this.index.application.helperInstanceId, 'git', query.projectId, entry.gitIdentity, entry.project.gitContext, query.branch, query.authorEmail, section, snapshot]
    const offset = this.index.cursors.offset(query.cursor, binding)
    const key = digest([principal.id, query.projectId, entry.gitIdentity, entry.project.gitContext, query.branch, query.authorEmail, section === 'commits' ? offset : 0])
    const cached = this.cache.get(key)
    const result = cached && cached.refs === snapshot && Date.now() - cached.at < 60_000 ? cached.result : await readGitHistory(entry, { branch: query.branch, author: query.authorEmail, offset: section === 'commits' ? offset : 0 })
    if (repository && await refs(entry) !== snapshot) throw new McpFailure('CURSOR_EXPIRED', 'Git refs changed while reading. Start a new first page.')
    if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw new McpFailure('RESOURCE_LIMIT', 'Git metadata exceeds the snapshot limit.')
    if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { at: Date.now(), refs: snapshot, result })
    const values = result[section]
    const total = section === 'commits' ? result.total : values.length
    const items = section === 'commits' ? values : values.slice(offset, offset + 25)
    const next = offset + items.length
    return { available: result.available, shallow: result.shallow, from: result.from, to: result.to, section, rows: { items, nextCursor: next < total ? this.index.cursors.encode(binding, next) : null, total, coverage: { known: items.length, missing: result.available ? 0 : 1, invalidated: 0, partial: result.shallow ? 1 : 0, completeness: result.available && !result.shallow ? 'complete' : 'unknown' } } }
  }
  async daily(principal: Principal, query: { rootId: string; from: string; to: string; authorEmail?: string }, context: { cancelled: () => boolean; progress: (value: { phase: string; completed: number; total: number }) => void }) {
    const entries = this.index.entries(principal, query.rootId)
    const seen = new Set<string>()
    const groups = new Map<string, RegisteredProject[]>()
    for (const entry of entries) {
      const context = entry.project.gitContext
      const key = context?.state === 'verified' ? context.repositoryId : entry.project.id
      const group = groups.get(key) ?? []
      group.push(entry)
      groups.set(key, group)
    }
    const candidates = [...groups.values()]
    const rows: unknown[] = []
    let bytes = 0
    const add = (row: unknown) => {
      bytes += Buffer.byteLength(JSON.stringify(row))
      if (bytes > 8 * 1024 * 1024) throw new McpFailure('RESOURCE_LIMIT', 'Daily summary exceeds 8 MiB. Query a smaller root.')
      rows.push(row)
    }
    for (const [position, group] of candidates.entries()) {
      const candidate = group[0]
      if (context.cancelled()) { add({ kind: 'cancelled', remaining: candidates.length - position }); break }
      context.progress({ phase: 'Reading local Git activity', completed: position, total: candidates.length })
      try {
        const context = candidate.project.gitContext
        const repositoryId = context?.state === 'verified' ? context.repositoryId : undefined
        const checkouts: RepositoryCheckout[] = []
        const checkoutIds = new Set<string>()
        for (const member of group) {
          const memberContext = member.project.gitContext
          const key = memberContext?.state === 'verified' ? memberContext.worktreeId : member.project.id
          if (checkoutIds.has(key)) continue
          checkoutIds.add(key)
          try { checkouts.push({ entry: await this.index.checkedEntry(principal, member.project.id, true) }) }
          catch { checkouts.push({ entry: member, error: 'Checkout unavailable.' }) }
        }
        const entry = checkouts.find(checkout => !checkout.error)?.entry
        if (!entry) throw new McpFailure('OPERATION_FAILED', 'No authorized checkout is available.')
        const repository = await gitRoot(entry)
        const key = repositoryId ?? repository
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        const day = repositoryId ? await readRepositoryGitDay(repositoryId, checkouts, query) : await readGitDay(entry, query)
        const commits = day.commits.filter(commit => !query.authorEmail || commit.email === query.authorEmail)
        add({ kind: 'repository', projectId: entry.project.id, repositoryId, coverage: 'coverage' in day ? day.coverage : undefined, available: day.available, shallow: day.shallow, commits: commits.length })
        for (const commit of commits) add({ ...commit, kind: 'commit', projectId: entry.project.id, repositoryId })
      } catch (error) {
        if (error instanceof McpFailure && error.code === 'RESOURCE_LIMIT') throw error
        add({ kind: 'repository', projectId: candidate.project.id, available: false, shallow: false, commits: 0, error: error instanceof McpFailure ? error.code : 'OPERATION_FAILED' })
      }
    }
    return rows
  }
}
