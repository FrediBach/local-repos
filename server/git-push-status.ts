import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitOptions } from './git-history'
import { HelperError, isWithin, type RegisteredProject } from './scanner'
import type { GitPushStatus } from '../src/types'

const exec = promisify(execFile)

/** Read current local refs without fetching, pushing, or changing the worktree. */
export async function readGitPushStatus(entry: RegisteredProject): Promise<GitPushStatus> {
  const directory = entry.workspaceDirectory ?? entry.directory
  const signal = AbortSignal.timeout(30_000)
  const git = async (args: string[]) => (await exec('git', [...gitOptions, ...args], {
    cwd: directory, timeout: 10_000, signal, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
  })).stdout.trim()
  const result: GitPushStatus = { available: false, hasOrigin: false, originRefsKnown: false, unpushedCommits: 0, dirty: false, shallow: false, checkedAt: new Date().toISOString() }
  let topLevel: string
  try { topLevel = await git(['rev-parse', '--show-toplevel']) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HelperError('Git is unavailable. Install Git and restart the local helper.', 503)
    if (/not a git repository/i.test(String((error as { stderr?: string }).stderr))) return result
    throw new HelperError('Could not read this repository. Sync the directory and try again.', 422)
  }
  if (!isWithin(entry.root, topLevel)) return result
  result.available = true
  try {
    const remotes = await git(['remote'])
    result.hasOrigin = remotes.split('\n').includes('origin')
    if (!result.hasOrigin) return result
    const [refs, head, status, shallow] = await Promise.all([
      git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads/', 'refs/remotes/origin/']),
      git(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => ''),
      git(['status', '--porcelain', '--untracked-files=normal']),
      git(['rev-parse', '--is-shallow-repository']),
    ])
    result.dirty = !!status
    result.shallow = shallow === 'true'
    const local = new Set<string>(head ? [head] : [])
    const origin = new Set<string>()
    for (const line of refs.split('\n').filter(Boolean)) {
      const [ref, hash, symbolic] = line.split('\0')
      if (symbolic) continue
      if (ref.startsWith('refs/heads/')) local.add(hash)
      else origin.add(hash)
    }
    result.originRefsKnown = origin.size > 0
    // Count shared commits once across every local branch and detached HEAD.
    // A commit already reachable on any origin branch has been pushed.
    if (local.size && origin.size) {
      const count = await git(['rev-list', '--count', ...local, '--not', ...origin, '--'])
      if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error('Invalid Git count')
      result.unpushedCommits = Number(count)
    }
    result.checkedAt = new Date().toISOString()
    return result
  } catch {
    throw new HelperError('Could not check for unpushed changes. Sync the directory and try again.', 422)
  }
}
