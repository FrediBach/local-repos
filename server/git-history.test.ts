import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readGitHistory } from './git-history'
import type { RegisteredProject } from './scanner'

const exec = promisify(execFile)
let root: string, directory: string, entry: RegisteredProject
const now = new Date('2026-10-08T12:00:00Z')
const git = (...args: string[]) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory })
async function commit(message: string, name = 'Alice', email = 'alice+test@example.com', date = '2026-10-07T12:00:00Z') {
  await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', message], {
    cwd: directory, env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-history-')))
  directory = path.join(root, 'project')
  await mkdir(directory)
  entry = { directory, root, project: { id: 'fixture', name: 'fixture', dirName: 'project', relativePath: 'project', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: now.toISOString() } }
  await git('init', '-b', 'main')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('Git history', () => {
  it('combines exact author and branch filters, deduplicates shared ancestry and includes remote branches', async () => {
    await commit('Initial shared commit', 'Alice', 'alice+test@example.com', '2024-01-01T12:00:00Z')
    await git('checkout', '-b', 'feature/new-ui')
    await commit('Feature change', 'Bob', 'bob@example.com')
    await git('checkout', 'main')
    await commit('Main change')
    const feature = (await git('rev-parse', 'feature/new-ui')).stdout.trim()
    await git('update-ref', 'refs/remotes/origin/feature', feature)
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature')
    const all = await readGitHistory(entry, {}, now)
    expect(all.total).toBe(3)
    expect(new Set(all.commits.map(c => c.hash)).size).toBe(3)
    expect(all.branches.map(branch => branch.ref)).toEqual(['refs/heads/feature/new-ui', 'refs/heads/main', 'refs/remotes/origin/feature'])
    expect(all.authors.map(author => author.name)).toEqual(['Alice', 'Bob'])
    expect(all.activity).toEqual([{ date: '2026-10-07', count: 2 }])
    const featureAlice = await readGitHistory(entry, { branch: 'refs/heads/feature/new-ui', author: 'alice+test@example.com' }, now)
    expect(featureAlice.total).toBe(1)
    expect(featureAlice.commits[0].message).toBe('Initial shared commit')
    expect(featureAlice.activity).toEqual([])
    expect((await readGitHistory(entry, { author: 'alice.*' }, now)).total).toBe(0)
    expect((await readGitHistory(entry, { branch: 'refs/remotes/origin/feature' }, now)).total).toBe(2)
  })

  it('pages the whole log while the heatmap counts every commit and normalizes timezone boundaries', async () => {
    for (let i = 0; i < 28; i++) await commit(`Commit ${i} · 日本語`)
    await commit('UTC previous day', 'Alice', 'alice+test@example.com', '2026-10-08T00:30:00+02:00')
    const first = await readGitHistory(entry, {}, now)
    const next = await readGitHistory(entry, { offset: 25 }, now)
    expect(first.commits).toHaveLength(25)
    expect(first.hasMore).toBe(true)
    expect(next.commits).toHaveLength(4)
    expect(next.hasMore).toBe(false)
    expect(new Set([...first.commits, ...next.commits].map(commit => commit.hash)).size).toBe(29)
    expect(first.commits[0].message).toBe('UTC previous day')
    expect(first.commits[1].message).toBe('Commit 27 · 日本語')
    expect(first.activity).toEqual([{ date: '2026-10-07', count: 29 }])
    expect(next.activity).toEqual(first.activity)
    expect(first.from).toBe('2025-10-09')
  })

  it('handles unborn repositories, non-Git projects and detached HEAD commits', async () => {
    expect(await readGitHistory(entry, {}, now)).toMatchObject({ available: true, total: 0, commits: [] })
    await commit('Base')
    await git('checkout', '--detach')
    await commit('Detached commit')
    expect((await readGitHistory(entry, {}, now)).total).toBe(2)
    const plain = path.join(root, 'plain')
    await mkdir(plain)
    expect(await readGitHistory({ ...entry, directory: plain }, {}, now)).toMatchObject({ available: false, total: 0 })
    await mkdir(path.join(directory, 'nested'))
    expect((await readGitHistory({ ...entry, root: path.join(directory, 'nested'), directory: path.join(directory, 'nested') }, {}, now)).available).toBe(false)
  })

  it('reads a monorepo at its root and identifies shallow history', async () => {
    await commit('Root change')
    const workspaceDirectory = directory
    const child = path.join(directory, 'packages', 'web')
    await mkdir(child, { recursive: true })
    expect((await readGitHistory({ ...entry, directory: child, workspaceDirectory }, {}, now)).total).toBe(1)
    const shallow = path.join(root, 'shallow')
    await git('clone', '--depth=1', `file://${directory}`, shallow)
    expect((await readGitHistory({ ...entry, directory: shallow }, {}, now)).shallow).toBe(true)
  })

  it('validates branch references and pagination without interpreting user input as Git arguments', async () => {
    await commit('Base')
    for (const branch of ['--all', 'main; touch surprise', 'HEAD~1', 'refs/heads/missing']) {
      await expect(readGitHistory(entry, { branch }, now)).rejects.toMatchObject({ status: 400 })
    }
    for (const offset of [-1, 1.5, '25', NaN]) await expect(readGitHistory(entry, { offset }, now)).rejects.toMatchObject({ status: 400 })
    await expect(readGitHistory(entry, { author: ['Alice'] }, now)).rejects.toMatchObject({ status: 400 })
  })

})
