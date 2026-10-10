import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitOptions, readCommits } from './git-history'
import { HelperError, isWithin, type RegisteredProject } from './scanner'
import type { GitDay, GitDayCommit, GitDayQuery, GitHistory } from '../src/types'

const exec = promisify(execFile)

function dayQuery(input: Record<string, unknown>): GitDayQuery {
  const { from, to } = input
  const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  if (!valid(from) || !valid(to)) throw new HelperError('Choose a valid summary date.')
  const hours = (Date.parse(to) - Date.parse(from)) / 3_600_000
  // Local calendar days may contain 23 or 25 hours at daylight-saving changes.
  if (hours < 22 || hours > 26) throw new HelperError('Choose a single day for the summary.')
  return { from, to }
}

export async function readGitDay(entry: RegisteredProject, input: Record<string, unknown>): Promise<GitDay> {
  const { from, to } = dayQuery(input)
  const directory = entry.gitDirectory ?? entry.workspaceDirectory ?? entry.directory
  const signal = AbortSignal.timeout(50_000)
  const git = async (args: string[]) => (await exec('git', [...gitOptions, ...args], {
    cwd: directory, timeout: 10_000, signal, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
  })).stdout.trim()
  const result: GitDay = { available: false, shallow: false, commits: [] }
  let topLevel: string
  try { topLevel = await git(['rev-parse', '--show-toplevel']) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HelperError('Git is unavailable. Install Git and restart the local helper.', 503)
    // A missing or inaccessible registered directory is a failure, not an empty day.
    if (!/not a git repository/i.test(String((error as { stderr?: string }).stderr))) throw new HelperError('Could not read this repository. Sync the directory and try again.', 422)
    return result
  }
  if (!isWithin(entry.root, topLevel)) return result
  result.available = true
  const [refs, head, shallow] = await Promise.all([
    git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads/', 'refs/remotes/']),
    git(['rev-parse', '--verify', 'HEAD']).catch(() => ''),
    git(['rev-parse', '--is-shallow-repository']),
  ])
  result.shallow = shallow === 'true'
  const tips = new Map<string, GitHistory['branches']>()
  for (const line of refs.split('\n').filter(Boolean)) {
    const [ref, hash, symbolic] = line.split('\0')
    if (symbolic) continue
    const branches = tips.get(hash) ?? []
    branches.push({ ref, name: ref.replace(/^refs\/(heads|remotes)\//, ''), remote: ref.startsWith('refs/remotes/') })
    tips.set(hash, branches)
  }
  if (head && !tips.has(head)) tips.set(head, [])
  const commits = new Map<string, GitDayCommit>()
  const pending = [...tips.entries()]
  let index = 0
  // Snapshot each tip, then traverse identical local/remote tips only once.
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (index < pending.length) {
      const [hash, branches] = pending[index++]
      // --since-as-filter visits old parents too, so skewed commit clocks cannot
      // hide an otherwise matching ancestor. Filter again for an exclusive end.
      await readCommits(directory, [`--since-as-filter=${from}`, `--until=${to}`, hash], commit => {
        const time = Date.parse(commit.committedAt)
        if (time < Date.parse(from) || time >= Date.parse(to) || !Number.isFinite(time)) return
        const existing = commits.get(commit.hash)
        if (existing) existing.branches.push(...branches)
        else commits.set(commit.hash, { ...commit, branches: [...branches] })
      }, signal)
    }
  }))
  result.commits = [...commits.values()].sort((a, b) => Date.parse(a.committedAt) - Date.parse(b.committedAt) || a.hash.localeCompare(b.hash))
  for (const commit of result.commits) commit.branches.sort((a, b) => Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name))
  return result
}
