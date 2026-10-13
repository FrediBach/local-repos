import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GitRepository, GitWorktree } from '../src/types'

const exec = promisify(execFile)
const MAX_OUTPUT = 1024 * 1024
const MAX_RECORDS = 512
const MAX_FIELD = 4096
export const worktreeGitOptions = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'log.showSignature=false']

/** Repository selection must never inherit another command's Git environment. */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  }
}

let running = 0
const waiting: (() => void)[] = []
async function git(directory: string, args: string[]): Promise<string> {
  if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve))
  else running++
  try {
    return (await exec('git', [...worktreeGitOptions, ...args], {
      cwd: directory, encoding: 'utf8', env: gitEnvironment(), timeout: 5000, maxBuffer: MAX_OUTPUT,
    })).stdout
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

const withoutFinalNewline = (value: string) => value.endsWith('\n') ? value.slice(0, -1) : value
const within = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const identityId = (prefix: string, directory: string) => `${prefix}_${createHash('sha256').update(directory).digest('hex').slice(0, 20)}`
/** A replacement .git directory must not inherit the previous repository's history cache. */
export const gitRepositoryId = (identity: Pick<GitIdentity, 'commonDirectory' | 'commonDevice' | 'commonInode'>) => identityId('repository', JSON.stringify([identity.commonDirectory, identity.commonDevice, identity.commonInode]))
export const gitWorktreeId = (directory: string) => identityId('worktree', directory)

export interface GitIdentity {
  checkoutDirectory: string
  gitDirectory: string
  commonDirectory: string
  checkoutDevice: number
  checkoutInode: number
  gitDevice: number
  gitInode: number
  commonDevice: number
  commonInode: number
}

async function readPointer(filename: string): Promise<string> {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FIELD) throw new Error('Git pointer is not a bounded regular file.')
    const buffer = Buffer.alloc(MAX_FIELD + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_FIELD) throw new Error('Git pointer is too large.')
    return withoutFinalNewline(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally { await handle.close() }
}

/** Resolve a checkout, not an arbitrary directory inheriting Git from a parent. */
export async function readGitIdentity(directory: string): Promise<GitIdentity> {
  const marker = path.join(directory, '.git')
  const info = await lstat(marker)
  if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new Error('Git metadata must not be a symbolic link.')
  if (info.isFile() && (!(await readPointer(marker)).startsWith('gitdir: ') || info.size > MAX_FIELD)) throw new Error('Git pointer could not be read.')
  const values = await Promise.all([
    git(directory, ['rev-parse', '--show-toplevel']),
    git(directory, ['rev-parse', '--absolute-git-dir']),
    git(directory, ['rev-parse', '--git-common-dir']),
  ])
  const paths = values.map((value, index) => index === 2 ? path.resolve(directory, withoutFinalNewline(value)) : withoutFinalNewline(value))
  if (paths.some(value => !path.isAbsolute(value) || value.includes('\0') || value.length > MAX_FIELD)) throw new Error('Git returned an unsupported repository path.')
  const [checkoutDirectory, gitDirectory, commonDirectory] = await Promise.all(paths.map(value => realpath(value)))
  if (checkoutDirectory !== directory) throw new Error('Git checkout identity changed.')
  if (gitDirectory !== commonDirectory) {
    if (path.dirname(gitDirectory) !== path.join(commonDirectory, 'worktrees')) throw new Error('Git worktree administration is outside its repository.')
    const backPointer = await readPointer(path.join(gitDirectory, 'gitdir'))
    const backPath = path.resolve(gitDirectory, backPointer)
    if (await realpath(backPath) !== await realpath(marker)) throw new Error('Git worktree pointer no longer matches this checkout.')
  }
  const [checkout, privateGit, common] = await Promise.all([stat(checkoutDirectory), stat(gitDirectory), stat(commonDirectory)])
  if (![checkout, privateGit, common].every(value => value.isDirectory())) throw new Error('Git repository directories are unavailable.')
  return { checkoutDirectory, gitDirectory, commonDirectory, checkoutDevice: checkout.dev, checkoutInode: checkout.ino, gitDevice: privateGit.dev, gitInode: privateGit.ino, commonDevice: common.dev, commonInode: common.ino }
}

export function sameGitIdentity(left: GitIdentity, right: GitIdentity): boolean {
  return (Object.keys(left) as (keyof GitIdentity)[]).every(key => left[key] === right[key])
}

export interface WorktreeRecord {
  directory: string
  head?: string
  branch?: string
  detached?: boolean
  unborn?: boolean
  bare?: boolean
  locked?: boolean
  lockReason?: string
  prunable?: boolean
  pruneReason?: string
}

/** Porcelain -z separates fields and records with NULs; paths may contain newlines. */
export function parseWorktreePorcelain(output: string): WorktreeRecord[] {
  if (Buffer.byteLength(output) > MAX_OUTPUT || !output.endsWith('\0\0')) throw new Error('Git worktree inventory is incomplete or exceeds its size limit.')
  const records: WorktreeRecord[] = []
  const directories = new Set<string>()
  let record: WorktreeRecord | undefined
  let seen = new Set<string>()
  for (const field of output.split('\0')) {
    if (field.length > MAX_FIELD) throw new Error('Git worktree inventory contains an oversized field.')
    if (!field) {
      if (record) {
        if (record.bare ? record.head || record.unborn || record.branch || record.detached : (!record.head && !record.unborn) || (!record.branch && !record.detached) || (record.branch && record.detached)) throw new Error('Git worktree inventory contains inconsistent checkout state.')
        if (directories.has(record.directory) || records.length >= MAX_RECORDS) throw new Error('Git worktree inventory is duplicated or exceeds its record limit.')
        directories.add(record.directory)
        records.push(record)
        record = undefined
        seen = new Set()
      }
      continue
    }
    const space = field.indexOf(' ')
    const key = space < 0 ? field : field.slice(0, space)
    const value = space < 0 ? '' : field.slice(space + 1)
    if (seen.has(key)) throw new Error('Git worktree inventory contains duplicate fields.')
    seen.add(key)
    if (key === 'worktree') {
      if (record || !path.isAbsolute(value)) throw new Error('Git worktree inventory contains an invalid path.')
      record = { directory: path.normalize(value) }
    } else {
      if (!record) throw new Error('Git worktree inventory contains an invalid record.')
      if (key === 'HEAD') {
        if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value)) throw new Error('Git worktree inventory contains an invalid commit.')
        if (/^0+$/.test(value)) record.unborn = true
        else record.head = value
      } else if (key === 'branch') {
        if (!value.startsWith('refs/heads/') || /[\r\n]/.test(value)) throw new Error('Git worktree inventory contains an invalid branch.')
        record.branch = value.slice('refs/heads/'.length)
      } else if (key === 'bare' || key === 'detached') {
        if (value) throw new Error('Git worktree inventory contains an invalid flag.')
        record[key] = true
      }
      else if (key === 'locked') { record.locked = true; if (value) record.lockReason = value.slice(0, 1024) }
      else if (key === 'prunable') { record.prunable = true; if (value) record.pruneReason = value.slice(0, 1024) }
    }
  }
  if (!records.length) throw new Error('Git worktree inventory is empty.')
  return records
}

export async function readWorktreeInventory(identity: GitIdentity, root: string): Promise<{ repository: GitRepository; records: WorktreeRecord[] }> {
  const checkedAt = new Date().toISOString()
  const id = gitRepositoryId(identity)
  const name = path.basename(path.basename(identity.commonDirectory) === '.git' ? path.dirname(identity.commonDirectory) : identity.commonDirectory).replace(/\.git$/, '') || path.basename(identity.checkoutDirectory)
  try {
    const records = parseWorktreePorcelain(await git(identity.checkoutDirectory, ['worktree', 'list', '--porcelain', '-z']))
    // Git cannot reconstruct the main checkout location from a separate Git
    // directory without core.worktree. A verified main checkout is authoritative.
    if (identity.gitDirectory === identity.commonDirectory && !records[0].bare) records[0].directory = identity.checkoutDirectory
    const worktrees: GitWorktree[] = records.map((record, index) => ({
      id: gitWorktreeId(record.directory),
      path: within(root, record.directory) ? path.relative(root, record.directory) || '.' : record.directory,
      role: record.bare ? 'bare' : index === 0 && !records[0].bare ? 'main' : 'linked',
      availability: within(root, record.directory) ? 'unscanned' : 'outside',
      branch: record.branch, head: record.head, detached: record.detached, unborn: record.unborn,
      locked: record.locked, lockReason: record.lockReason, prunable: record.prunable, pruneReason: record.pruneReason,
    }))
    return { repository: { id, name, checkedAt, status: 'complete', worktrees }, records }
  } catch {
    return { repository: { id, name, checkedAt, status: 'unavailable', error: 'Git worktree inventory could not be read. Check Git support and sync again.', worktrees: [] }, records: [] }
  }
}
