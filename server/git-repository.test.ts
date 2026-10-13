import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelperApplication } from './application'
import { readGitHistory } from './git-history'
import { GitReads } from './mcp/git'
import { rootId, type Principal } from './mcp/policy'
import type { RepositoryGitScope } from '../src/types'
import * as worktreeService from './git-worktrees'

const exec = promisify(execFile)
let temp: string, root: string, main: string, linked: string, application: HelperApplication
const query = { from: '2026-10-10T00:00:00.000Z', to: '2026-10-11T00:00:00.000Z' }
const git = (directory: string, ...args: string[]) => exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: directory, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-10T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T12:00:00Z' } })
const commit = (directory: string, message: string) => git(directory, 'commit', '--allow-empty', '-qm', message)
async function scan() {
  const result = await application.scan(root)
  const context = result.projects[0].gitContext
  if (context?.state !== 'verified') throw new Error('Fixture needs Git identity')
  const scope: RepositoryGitScope = { rootId: result.rootId, repositoryId: context.repositoryId, projectIds: result.projects.filter(project => project.gitContext?.state === 'verified' && project.gitContext.repositoryId === context.repositoryId).map(project => project.id) }
  const anchor = result.projects.find(project => project.relativePath === 'main')!.id
  return { result, scope, anchor }
}
const principal = (directory: string, disclosePaths = false): Principal => ({ id: 'reader', roots: [{ id: rootId(directory), directory, name: path.basename(directory) }], capabilities: ['read', 'git'], discloseContent: true, disclosePaths })

beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-aggregate-')))
  root = path.join(temp, 'projects'); main = path.join(root, 'main'); linked = path.join(root, 'linked')
  await mkdir(main, { recursive: true })
  await git(main, 'init', '-b', 'main')
  await writeFile(path.join(main, 'package.json'), JSON.stringify({ name: 'fixture' }))
  await git(main, 'add', 'package.json'); await commit(main, 'Shared')
  const origin = path.join(temp, 'origin.git')
  await git(main, 'init', '--bare', origin); await git(main, 'remote', 'add', 'origin', origin); await git(main, 'push', '-u', 'origin', 'main')
  await git(main, 'worktree', 'add', '--detach', linked)
  application = new HelperApplication()
})
afterEach(async () => { vi.restoreAllMocks(); await application.shutdown(); await rm(temp, { recursive: true, force: true }) })

describe('repository Git reads', () => {
  it('unions eligible detached tips once and reports each checkout working state', async () => {
    await commit(main, 'Main'); await commit(linked, 'Detached')
    await writeFile(path.join(linked, 'draft.txt'), 'Uncommitted')
    const { scope, anchor, result } = await scan()
    const history = await application.repositoryHistory(anchor, { ...scope })
    expect(history).toMatchObject({ available: true, coverage: 'complete', total: 3, repositoryId: scope.repositoryId })
    expect((await readGitHistory(await application.registry.get(anchor))).total).toBe(2)
    expect((await application.repositoryDay(anchor, { ...scope, ...query })).commits.map(commit => commit.message).sort()).toEqual(['Detached', 'Main', 'Shared'])
    const push = await application.repositoryPushStatus(anchor, { ...scope, projectIds: [...scope.projectIds, anchor] })
    expect(push).toMatchObject({ unpushedCommits: 2, dirty: true, coverage: 'complete' })
    expect(push.checkouts).toHaveLength(2)
    expect(push.checkouts.find(row => row.path === 'main')).toMatchObject({ dirty: false })
    expect(push.checkouts.find(row => row.path === 'linked')).toMatchObject({ dirty: true })
    expect(application.workspaceState(scope.rootId).repositories).toEqual(result.repositories)
  })

  it('rejects foreign, unregistered, and no-longer-current member selections', async () => {
    const { scope, anchor } = await scan()
    await expect(application.repositoryHistory(anchor, { ...scope, projectIds: [] })).rejects.toMatchObject({ status: 400 })
    await expect(application.repositoryHistory(anchor, { ...scope, projectIds: ['a'.repeat(20)] })).rejects.toMatchObject({ status: 400 })
    await expect(application.repositoryHistory(anchor, { ...scope, projectIds: [...scope.projectIds, 'a'.repeat(20)] })).rejects.toMatchObject({ status: 409 })
    await expect(application.repositoryHistory(anchor, { ...scope, repositoryId: 'other-repository' })).rejects.toMatchObject({ status: 409 })
    await expect(application.repositoryHistory(anchor, { ...scope, rootId: `root_${'f'.repeat(20)}` })).rejects.toMatchObject({ status: 404 })
    await git(main, 'worktree', 'remove', linked)
    await application.scan(root)
    await expect(application.repositoryHistory(anchor, { ...scope })).rejects.toMatchObject({ status: 409 })
  })

  it('preserves partial coverage if a selected checkout disappears after discovery', async () => {
    await commit(linked, 'Detached')
    const { scope, anchor } = await scan()
    await rm(linked, { recursive: true })
    expect(await application.repositoryHistory(anchor, { ...scope })).toMatchObject({ available: true, total: 1, coverage: 'partial' })
    const push = await application.repositoryPushStatus(anchor, { ...scope })
    expect(push.coverage).toBe('partial')
    expect(push.checkouts.find(row => row.path === 'linked')).toMatchObject({ error: expect.any(String) })
    expect(push.checkouts.find(row => row.path === 'linked')?.dirty).toBeUndefined()
  })

  it('keeps a dated inventory after a failed refresh, and retires successfully removed worktrees', async () => {
    const { scope, result } = await scan()
    const original = worktreeService.readWorktreeInventory
    const read = vi.spyOn(worktreeService, 'readWorktreeInventory').mockImplementation(async (identity, selectedRoot) => ({ ...(await original(identity, selectedRoot)), repository: { id: scope.repositoryId, name: 'Fixture', checkedAt: '2099-01-01T00:00:00Z', status: 'unavailable', error: 'Unavailable', worktrees: [] }, records: [] }))
    const refreshed = await application.scan(root)
    expect(refreshed.repositories?.[0]).toMatchObject({ status: 'unavailable', checkedAt: result.repositories?.[0].checkedAt })
    expect(refreshed.repositories?.[0].worktrees).toHaveLength(2)
    read.mockRestore()
    await git(main, 'worktree', 'remove', linked)
    const removed = await application.scan(root)
    expect(removed.repositories?.[0].worktrees).toHaveLength(1)
    expect(removed.projects).toHaveLength(1)
  })

  it('reports working changes without origin and keeps inherited Git overrides out of reads', async () => {
    await git(main, 'remote', 'remove', 'origin')
    await writeFile(path.join(linked, 'draft.txt'), 'Uncommitted')
    const { scope, anchor } = await scan()
    vi.stubEnv('GIT_DIR', path.join(temp, 'untrusted'))
    try {
      expect(await application.repositoryPushStatus(anchor, { ...scope })).toMatchObject({ available: true, hasOrigin: false, dirty: true, coverage: 'complete' })
    } finally { vi.unstubAllEnvs() }
  })

  it('projects authorized checkout membership without sibling paths, counts, reasons, or detached tips', async () => {
    await commit(linked, 'Private detached')
    await git(main, 'worktree', 'lock', '--reason', 'secret/private-reason', linked)
    await application.scan(root)
    const narrow = await application.scan(main)
    const anchor = narrow.projects[0].id
    const granted = principal(main)
    const detail = application.index.detail(granted, anchor)
    expect(detail.repository?.worktrees).toHaveLength(1)
    expect(detail.repository?.worktrees[0].path).toBeUndefined()
    const encoded = JSON.stringify(detail)
    expect(encoded).not.toContain(linked)
    expect(encoded).not.toContain('private-reason')
    expect(encoded).not.toContain('Private detached')
    const reads = new GitReads(application.index)
    const day = await reads.daily(granted, { rootId: narrow.rootId, ...query }, { cancelled: () => false, progress: () => {} })
    expect(day).toMatchObject([{ kind: 'repository', commits: 1 }, { kind: 'commit', message: 'Shared' }])
    expect(application.index.detail(principal(main, true), anchor).repository?.worktrees[0].path).toBe('.')
  })

  it('MCP counts shared history once, includes authorized detached work, and keeps independent clones separate', async () => {
    await commit(linked, 'Detached')
    await git(main, 'clone', '--quiet', main, path.join(root, 'clone'))
    await application.scan(root)
    const reads = new GitReads(application.index)
    const rows = await reads.daily(principal(root), { rootId: rootId(root), ...query }, { cancelled: () => false, progress: () => {} })
    const repositories = rows.filter(row => (row as { kind: string }).kind === 'repository')
    expect(repositories).toHaveLength(2)
    expect(repositories).toEqual(expect.arrayContaining([expect.objectContaining({ commits: 2 }), expect.objectContaining({ commits: 1 })]))
    expect(rows.filter(row => (row as { message?: string }).message === 'Shared')).toHaveLength(2)
    expect(rows.filter(row => (row as { message?: string }).message === 'Detached')).toHaveLength(1)
  })
})
