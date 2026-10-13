import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitEnvironment, gitRepositoryId, parseWorktreePorcelain, readGitIdentity, readWorktreeInventory, sameGitIdentity } from './git-worktrees'

const exec = promisify(execFile)
let directory: string
const git = (args: string[], cwd = directory) => exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd, env: gitEnvironment() })

beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-worktree-test-')))
  await git(['init', '-b', 'main'])
  await git(['commit', '--allow-empty', '--no-gpg-sign', '-m', 'Initial'])
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('Git worktree inventory', () => {
  it('parses NUL fields without changing paths, branch names or multi-line reasons', () => {
    const result = parseWorktreePorcelain(`worktree /projects/space and\nnewline \0HEAD ${'a'.repeat(40)}\0branch refs/heads/feature/deep\0locked Disk\nis offline\0\0worktree /projects/detached\0HEAD ${'b'.repeat(64)}\0detached\0prunable\0\0`)
    expect(result).toEqual([
      { directory: '/projects/space and\nnewline ', head: 'a'.repeat(40), branch: 'feature/deep', locked: true, lockReason: 'Disk\nis offline' },
      { directory: '/projects/detached', head: 'b'.repeat(64), detached: true, prunable: true },
    ])
  })

  it('retains bare and unborn records and tolerates unknown bounded fields', () => {
    expect(parseWorktreePorcelain(`worktree /repo.git\0bare\0future value\0\0worktree /new\0HEAD ${'0'.repeat(40)}\0branch refs/heads/main\0\0`)).toEqual([
      { directory: '/repo.git', bare: true }, { directory: '/new', unborn: true, branch: 'main' },
    ])
  })

  it.each([
    '', 'worktree /partial\0', 'worktree relative\0\0', 'HEAD abc\0\0',
    'worktree /same\0\0worktree /same\0\0', 'worktree /a\0HEAD invalid\0\0',
    'worktree /a\0locked\0locked\0\0', `worktree /${'a'.repeat(4096)}\0\0`,
    Array.from({ length: 513 }, (_, index) => `worktree /${index}\0\0`).join(''),
  ])('rejects malformed, duplicated or excessive inventory: %s', output => {
    expect(() => parseWorktreePorcelain(output)).toThrow()
  })

  it('resolves private and common directories and reads locked detached state', async () => {
    const linked = path.join(directory, 'linked\ncheckout')
    await git(['worktree', 'add', '--detach', linked])
    await git(['worktree', 'lock', '--reason', 'Review in progress', linked])
    const main = await readGitIdentity(directory)
    const other = await readGitIdentity(linked)
    expect(main.gitDirectory).toBe(main.commonDirectory)
    expect(other.commonDirectory).toBe(main.commonDirectory)
    expect(other.gitDirectory).not.toBe(main.gitDirectory)
    expect(gitRepositoryId(other)).toBe(gitRepositoryId(main))
    expect(gitRepositoryId(await readGitIdentity(directory))).toBe(gitRepositoryId(main))
    const { repository } = await readWorktreeInventory(other, linked)
    expect(repository.status).toBe('complete')
    expect(repository.worktrees).toMatchObject([
      { path: directory, role: 'main', availability: 'outside', branch: 'main' },
      { path: '.', role: 'linked', availability: 'unscanned', detached: true, locked: true, lockReason: 'Review in progress' },
    ])
  })

  it('does not inherit repository-selection environment overrides', async () => {
    vi.stubEnv('GIT_DIR', '/does-not-exist')
    vi.stubEnv('GIT_WORK_TREE', '/does-not-exist')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.bare')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true')
    expect((await readGitIdentity(directory)).checkoutDirectory).toBe(directory)
  })

  it('rejects Git marker symlinks and retargeted worktree back-pointers', async () => {
    const linked = path.join(directory, 'linked')
    await git(['worktree', 'add', '-b', 'linked', linked])
    const identity = await readGitIdentity(linked)
    await writeFile(path.join(identity.gitDirectory, 'gitdir'), `${path.join(directory, '.git')}\n`)
    await expect(readGitIdentity(linked)).rejects.toThrow('pointer')
    await rename(path.join(directory, '.git'), path.join(directory, 'git-data'))
    await symlink(path.join(directory, 'git-data'), path.join(directory, '.git'))
    await expect(readGitIdentity(directory)).rejects.toThrow('symbolic link')
  })

  it('detects a replacement repository at the same checkout path', async () => {
    const before = await readGitIdentity(directory)
    await rename(path.join(directory, '.git'), path.join(directory, 'old-git'))
    await git(['init', '-b', 'replacement'])
    const after = await readGitIdentity(directory)
    expect(after.commonDirectory).toBe(before.commonDirectory)
    expect(sameGitIdentity(before, after)).toBe(false)
    expect(gitRepositoryId(after)).not.toBe(gitRepositoryId(before))
  })

  it('keeps a failed inventory unavailable instead of claiming no worktrees', async () => {
    const identity = await readGitIdentity(directory)
    vi.stubEnv('PATH', '')
    const { repository } = await readWorktreeInventory(identity, directory)
    expect(repository).toMatchObject({ status: 'unavailable', worktrees: [], error: expect.any(String) })
  })
})
