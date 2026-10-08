import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { HelperError, isWithin, type RegisteredProject } from './scanner'
import type { GitCommit, GitHistory, GitHistoryQuery } from '../src/types'

const execFileAsync = promisify(execFile)
export const gitOptions = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'log.showSignature=false']
const PAGE_SIZE = 25

function queryOptions(input: Record<string, unknown>): GitHistoryQuery {
  const { branch = '', author = '', offset = 0 } = input
  if (typeof branch !== 'string' || branch.length > 1024 || /[\0\r\n]/.test(branch)) throw new HelperError('Choose a valid branch.')
  if (typeof author !== 'string' || author.length > 1024 || /[\0\r\n]/.test(author)) throw new HelperError('Choose a valid author.')
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new HelperError('Choose a valid commit page.')
  return { branch, author, offset: offset as number }
}

/** Read NUL-delimited Git records incrementally; large repositories do not fill memory. */
export async function readCommits(directory: string, revisions: string[], visit: (commit: GitCommit) => void, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', [...gitOptions, 'log', '--date-order', '--no-color', '--no-decorate', '--encoding=UTF-8', '--format=%H%x00%aN%x00%aE%x00%cI%x00%s%x00', ...revisions, '--'], {
      cwd: directory, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], signal,
    })
    const timeout = setTimeout(() => { child.kill(); reject(new HelperError('Reading Git history timed out. Try a specific branch.', 504)) }, 30_000)
    let pending = '', fields: string[] = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let end: number
      while ((end = pending.indexOf('\0')) !== -1) {
        fields.push(pending.slice(0, end)); pending = pending.slice(end + 1)
        if (fields.length === 5) {
          const [hash, author, email, committedAt, message] = fields
          visit({ hash: hash.trim(), author, email, committedAt, message })
          fields = []
        }
      }
      if (pending.length > 1_048_576) { child.kill(); reject(new HelperError('A Git history record is too large to read.', 422)) }
    })
    child.stderr.resume()
    child.once('error', error => { clearTimeout(timeout); reject(new HelperError(error.name === 'AbortError' ? 'Reading Git history timed out. Try again.' : 'Git is unavailable. Install Git and restart the local helper.', error.name === 'AbortError' ? 504 : 503)) })
    child.once('close', code => {
      clearTimeout(timeout)
      if (code !== 0) reject(new HelperError('Could not read Git history. Sync the project and try again.', 422))
      else resolve()
    })
  })
}

export async function readGitHistory(entry: RegisteredProject, input: Record<string, unknown> = {}, now = new Date()): Promise<GitHistory> {
  const query = queryOptions(input)
  const directory = entry.workspaceDirectory ?? entry.directory
  const git = async (args: string[]) => (await execFileAsync('git', [...gitOptions, ...args], {
    cwd: directory, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  })).stdout.trim()
  const to = now.toISOString().slice(0, 10)
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 364)
  const from = start.toISOString().slice(0, 10)
  const result: GitHistory = { available: false, branches: [], authors: [], commits: [], total: 0, offset: query.offset ?? 0, hasMore: false, activity: [], from, to, shallow: false }
  let topLevel: string
  try { topLevel = await git(['rev-parse', '--show-toplevel']) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HelperError('Git is unavailable. Install Git and restart the local helper.', 503)
    return result
  }
  // A package outside a repository must not inherit Git history from an unselected parent.
  if (!isWithin(entry.root, topLevel)) return result
  result.available = true
  const [refs, head, shallow] = await Promise.all([
    git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads/', 'refs/remotes/']),
    git(['rev-parse', '--verify', 'HEAD']).catch(() => ''),
    git(['rev-parse', '--is-shallow-repository']),
  ])
  result.shallow = shallow === 'true'
  const tips = new Map<string, string>()
  for (const line of refs.split('\n').filter(Boolean)) {
    const [ref, hash, symbolic] = line.split('\0')
    if (symbolic) continue
    tips.set(ref, hash)
    result.branches.push({ ref, name: ref.replace(/^refs\/(heads|remotes)\//, ''), remote: ref.startsWith('refs/remotes/') })
  }
  if (query.branch && !tips.has(query.branch)) throw new HelperError('This branch is no longer available. Refresh commit history.', 400)
  // Snapshot the tips so moving refs cannot change the traversal mid-request.
  const revisions = query.branch ? [tips.get(query.branch)!] : [...new Set([...tips.values(), ...(head ? [head] : [])])]
  if (!revisions.length) return result
  const authors = new Map<string, { name: string; email: string }>()
  const activity = new Map<string, number>()
  await readCommits(directory, revisions, commit => {
    authors.set(commit.email, { name: commit.author, email: commit.email })
    if (query.author && commit.email !== query.author) return
    const index = result.total++
    if (index >= result.offset && result.commits.length < PAGE_SIZE) result.commits.push(commit)
    const timestamp = Date.parse(commit.committedAt)
    if (!Number.isFinite(timestamp)) return
    const day = new Date(timestamp).toISOString().slice(0, 10)
    if (day >= from && day <= to) activity.set(day, (activity.get(day) ?? 0) + 1)
  })
  result.authors = [...authors.values()].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
  result.activity = [...activity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))
  result.hasMore = result.offset + result.commits.length < result.total
  return result
}
