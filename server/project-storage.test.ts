import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measureProjectStorage, removeProjectNodeModules } from './project-storage'

let temporary: string
let project: string

beforeEach(async () => {
  temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-storage-test-')))
  project = path.join(temporary, 'project')
  await mkdir(project)
  await writeFile(path.join(project, 'package.json'), '{"name":"fixture"}')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(temporary, { recursive: true, force: true })
})

async function allocated(filename: string): Promise<number> {
  const info = await lstat(filename)
  return Number.isFinite(info.blocks) && info.blocks >= 0 ? info.blocks * 512 : info.size
}

describe('project disk usage', () => {
  it('distinguishes dependency traversal from project traversal and reports observed entry counts', async () => {
    await mkdir(path.join(project, 'node_modules'))
    await writeFile(path.join(project, 'node_modules', 'package.js'), 'export default true')
    const progress = vi.fn()
    await measureProjectStorage(project, progress)
    const phases = progress.mock.calls.map(([value]) => value.phase)
    expect(phases.indexOf('Measuring node_modules')).toBeLessThan(phases.indexOf('Measuring project files and build output'))
    expect(progress.mock.lastCall?.[0]).toEqual({ phase: 'Preparing the storage report', detail: '4 filesystem entries checked' })
  })

  it('includes hidden files and dependencies, deduplicates hard links, and never follows symlinks', async () => {
    const modules = path.join(project, 'node_modules')
    const git = path.join(project, '.git')
    await mkdir(modules)
    await mkdir(git)
    await writeFile(path.join(modules, 'package.js'), 'export default true')
    await link(path.join(modules, 'package.js'), path.join(modules, 'hard-link.js'))
    await writeFile(path.join(git, 'objects'), Buffer.alloc(8_192, 42))
    const outside = path.join(temporary, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'large-secret'), Buffer.alloc(1_048_576, 42))
    await symlink(outside, path.join(modules, 'outside-link'))
    await symlink(project, path.join(modules, 'parent-loop'))

    const moduleFiles = [modules, path.join(modules, 'package.js'), path.join(modules, 'outside-link'), path.join(modules, 'parent-loop')]
    const moduleBytes = (await Promise.all(moduleFiles.map(allocated))).reduce((sum, size) => sum + size, 0)
    const sourceBytes = (await Promise.all([project, path.join(project, 'package.json'), git, path.join(git, 'objects')].map(allocated))).reduce((sum, size) => sum + size, 0)
    const result = await measureProjectStorage(project)
    expect(result).toMatchObject({ hasNodeModules: true, nodeModulesBytes: moduleBytes, totalBytes: moduleBytes + sourceBytes, partial: false })
    expect(Number.isNaN(Date.parse(result.measuredAt))).toBe(false)
  })

  it('reports projects without installed dependencies', async () => {
    expect(await measureProjectStorage(project)).toMatchObject({ nodeModulesBytes: 0, hasNodeModules: false, partial: false })
  })

  it('marks bounded scans as partial', async () => {
    let time = 0
    vi.spyOn(Date, 'now').mockImplementation(() => time += 25_000)
    expect(await measureProjectStorage(project)).toMatchObject({ partial: true })
  })
})

describe('dependency cleanup', () => {
  it('removes only the root dependencies and preserves nested projects and external symlink targets', async () => {
    const modules = path.join(project, 'node_modules')
    const nested = path.join(project, 'packages', 'nested', 'node_modules')
    const external = path.join(temporary, 'external')
    await mkdir(modules)
    await mkdir(nested, { recursive: true })
    await mkdir(external)
    await writeFile(path.join(modules, 'index.js'), 'root dependency')
    await writeFile(path.join(nested, 'index.js'), 'nested dependency')
    await writeFile(path.join(external, 'index.js'), 'external dependency')
    await symlink(external, path.join(modules, 'linked-package'))
    const result = await removeProjectNodeModules(project)
    expect(result).toMatchObject({ hasNodeModules: false, nodeModulesBytes: 0, partial: false })
    await expect(lstat(modules)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(nested, 'index.js'), 'utf8')).toBe('nested dependency')
    expect(await readFile(path.join(external, 'index.js'), 'utf8')).toBe('external dependency')
    expect(await readFile(path.join(project, 'package.json'), 'utf8')).toBe('{"name":"fixture"}')
  })

  it('treats already absent dependencies as a successful refresh', async () => {
    expect(await removeProjectNodeModules(project)).toMatchObject({ hasNodeModules: false, nodeModulesBytes: 0 })
  })

  it('refuses a symlinked node_modules root without touching the link or target', async () => {
    const external = path.join(temporary, 'external')
    await mkdir(external)
    await writeFile(path.join(external, 'keep'), 'keep me')
    await symlink(external, path.join(project, 'node_modules'))
    await expect(removeProjectNodeModules(project)).rejects.toMatchObject({ status: 409 })
    expect((await lstat(path.join(project, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await readFile(path.join(external, 'keep'), 'utf8')).toBe('keep me')
  })

  it('refuses files named node_modules and project directories replaced by symlinks', async () => {
    await writeFile(path.join(project, 'node_modules'), 'important file')
    await expect(removeProjectNodeModules(project)).rejects.toThrow('real node_modules directory')
    const moved = path.join(temporary, 'moved')
    await rename(project, moved)
    await symlink(moved, project)
    await expect(removeProjectNodeModules(project)).rejects.toMatchObject({ status: 403 })
    await expect(measureProjectStorage(project)).rejects.toMatchObject({ status: 403 })
    expect(await readFile(path.join(moved, 'node_modules'), 'utf8')).toBe('important file')
  })

  it('rejects filesystem roots and relative paths', async () => {
    await expect(removeProjectNodeModules(path.parse(project).root)).rejects.toMatchObject({ status: 400 })
    await expect(removeProjectNodeModules('.')).rejects.toMatchObject({ status: 400 })
  })
})

it('rechecks a prepared cleanup identity inside the removal service', async () => {
  const modules = path.join(project, 'node_modules')
  await mkdir(modules)
  await writeFile(path.join(modules, 'keep'), 'fixture')
  const info = await lstat(modules, { bigint: true })
  await expect(removeProjectNodeModules(project, { dev: String(info.dev), ino: String(info.ino + 1n) })).rejects.toThrow('changed')
  expect(await readFile(path.join(modules, 'keep'), 'utf8')).toBe('fixture')
  await rm(modules, { recursive: true })
  await expect(removeProjectNodeModules(project, { dev: String(info.dev), ino: String(info.ino) })).rejects.toThrow()
})
