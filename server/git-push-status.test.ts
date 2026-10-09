import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readGitPushStatus } from './git-push-status'
import type { RegisteredProject } from './scanner'

const exec = promisify(execFile)
let root: string, directory: string, entry: RegisteredProject
const git = (...args: string[]) => exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: directory })
const commit = (message: string) => git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', message)

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-push-')))
  directory = path.join(root, 'project')
  await mkdir(directory)
  await git('init', '-b', 'main')
  await git('init', '--bare', path.join(root, 'origin.git'))
  await git('remote', 'add', 'origin', path.join(root, 'origin.git'))
  entry = { root, directory, project: { id: 'fixture', name: 'Fixture', dirName: 'project', relativePath: 'project', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' } }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('fresh local push status', () => {
  it('detects commits and uncommitted files, and clears after a real push to a local origin', async () => {
    await commit('Initial')
    await git('push', '-u', 'origin', 'main')
    expect(await readGitPushStatus(entry)).toMatchObject({ available: true, hasOrigin: true, originRefsKnown: true, unpushedCommits: 0, dirty: false })
    await commit('Work')
    await writeFile(path.join(directory, 'draft.txt'), 'Uncommitted work')
    expect(await readGitPushStatus(entry)).toMatchObject({ unpushedCommits: 1, dirty: true })
    await git('add', 'draft.txt')
    await commit('Save draft')
    await git('push', 'origin', 'main')
    expect(await readGitPushStatus(entry)).toMatchObject({ unpushedCommits: 0, dirty: false })
  })

  it('includes inactive branches, shared local ancestry and detached HEAD without double counting', async () => {
    await commit('Initial')
    await git('push', '-u', 'origin', 'main')
    await git('checkout', '-b', 'feature')
    await commit('Shared work')
    await git('branch', 'other-feature')
    await git('checkout', 'main')
    expect((await readGitPushStatus(entry)).unpushedCommits).toBe(1)
    await git('checkout', '--detach')
    await commit('Detached work')
    expect((await readGitPushStatus(entry)).unpushedCommits).toBe(2)
    await git('push', 'origin', 'feature')
    expect((await readGitPushStatus(entry)).unpushedCommits).toBe(1)
  })

  it('excludes work already on any origin branch and ignores other remotes', async () => {
    await commit('Initial')
    await git('push', '-u', 'origin', 'main')
    await commit('Local work')
    await git('update-ref', 'refs/remotes/elsewhere/main', 'HEAD')
    expect((await readGitPushStatus(entry)).unpushedCommits).toBe(1)
    await git('push', 'origin', 'HEAD:renamed-branch')
    expect((await readGitPushStatus(entry)).unpushedCommits).toBe(0)
  })

  it('reports missing origin refs as unknown and skips repositories without origin', async () => {
    expect(await readGitPushStatus(entry)).toMatchObject({ available: true, hasOrigin: true, originRefsKnown: false })
    await commit('Never pushed')
    expect(await readGitPushStatus(entry)).toMatchObject({ originRefsKnown: false, unpushedCommits: 0 })
    await git('remote', 'remove', 'origin')
    expect((await readGitPushStatus(entry)).hasOrigin).toBe(false)
  })

  it('uses the repository root for members and respects the selected directory boundary', async () => {
    await commit('Initial')
    await git('push', 'origin', 'main')
    await commit('Root work')
    const child = path.join(directory, 'packages/web')
    await mkdir(child, { recursive: true })
    expect((await readGitPushStatus({ ...entry, directory: child, workspaceDirectory: directory })).unpushedCommits).toBe(1)
    expect((await readGitPushStatus({ ...entry, directory: child, root: child })).available).toBe(false)
    const plain = path.join(root, 'plain')
    await mkdir(plain)
    expect((await readGitPushStatus({ ...entry, directory: plain })).available).toBe(false)
    await expect(readGitPushStatus({ ...entry, directory: path.join(root, 'missing') })).rejects.toThrow()
  })
})
