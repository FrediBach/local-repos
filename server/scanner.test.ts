import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWithin, ProjectRegistry, scanDirectory } from './scanner'

const execFileAsync = promisify(execFile)
let temporary: string
let root: string

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'local-repos-scan-test-'))
  root = path.join(temporary, 'repos')
  await mkdir(root)
})
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

async function fixture(name: string, metadata: unknown = { name }): Promise<string> {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(metadata))
  return directory
}

describe('local directory scanning', () => {
  it.each(['AGENTS.md', 'AGENTS.m', 'CLAUDE.md'])('detects a root %s file, including empty files', async filename => {
    const directory = await fixture('assisted')
    await writeFile(path.join(directory, filename), '')
    expect((await scanDirectory(directory)).result.projects[0].aiInstructionFiles).toEqual([filename])
  })

  it('keeps AI markers local to each project root and ignores directories with marker names', async () => {
    const monorepo = await fixture('studio', { name: 'studio', workspaces: ['apps/*'] })
    await writeFile(path.join(monorepo, 'AGENTS.md'), 'Root instructions')
    await writeFile(path.join(monorepo, 'CLAUDE.md'), 'Root instructions')
    const child = await fixture('studio/apps/web', { name: 'web' })
    await mkdir(path.join(child, 'AGENTS.md'))
    await mkdir(path.join(child, 'docs'))
    await writeFile(path.join(child, 'docs', 'CLAUDE.md'), 'Nested instructions')
    const { result } = await scanDirectory(monorepo)
    expect(result.projects.find(project => project.name === 'studio')?.aiInstructionFiles).toEqual(['AGENTS.md', 'CLAUDE.md'])
    expect(result.projects.find(project => project.name === 'web')?.aiInstructionFiles).toEqual([])
  })

  it('detects internal marker symlinks and clears removed markers on rescan', async () => {
    const directory = await fixture('assisted')
    await writeFile(path.join(directory, 'CLAUDE.md'), 'Instructions')
    await symlink('CLAUDE.md', path.join(directory, 'AGENTS.md'))
    await writeFile(path.join(temporary, 'outside.md'), 'Outside instructions')
    await symlink(path.join(temporary, 'outside.md'), path.join(directory, 'AGENTS.m'))
    const registry = new ProjectRegistry()
    const first = (await scanDirectory(root)).registered
    registry.register(first)
    expect(first[0].project.aiInstructionFiles).toEqual(['AGENTS.md', 'CLAUDE.md'])
    await rm(path.join(directory, 'CLAUDE.md'))
    registry.register((await scanDirectory(root)).registered)
    expect(registry.lookup(first[0].project.id).project.aiInstructionFiles).toEqual([])
  })

  it('discovers multiple workspace apps, inherits their manager and excludes nonmembers', async () => {
    const monorepo = await fixture('studio', { name: 'studio', packageManager: 'pnpm@10.0.0' })
    await writeFile(path.join(monorepo, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n  - "!apps/ignored"\n')
    await writeFile(path.join(monorepo, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    await fixture('studio/apps/web', { name: '@studio/web', scripts: { dev: 'vite' }, dependencies: { react: '^19' } })
    await fixture('studio/apps/admin', { name: '@studio/admin', scripts: { dev: 'next dev' } })
    await fixture('studio/apps/ignored')
    await fixture('studio/packages/ui', { name: '@studio/ui' })
    await fixture('studio/examples/unlisted')
    const { registered } = await scanDirectory(root)
    expect(registered.map(entry => entry.project.name).sort()).toEqual(['@studio/admin', '@studio/ui', '@studio/web', 'studio'])
    const parent = registered.find(entry => entry.project.name === 'studio')!
    const web = registered.find(entry => entry.project.name === '@studio/web')!
    expect(parent.project.workspacePackageCount).toBe(3)
    expect(web).toMatchObject({ directory: await realpath(path.join(monorepo, 'apps/web')), workspaceDirectory: await realpath(monorepo), project: { packageManager: 'pnpm', monorepo: { id: parent.project.id, name: 'studio', packagePath: 'apps/web' }, scripts: { dev: 'vite' } } })
    expect((await scanDirectory(monorepo)).result.projects).toHaveLength(4)
    const registry = new ProjectRegistry()
    registry.register(registered)
    expect(registry.related(web.project.id)).toHaveLength(4)
  })

  it('supports npm/Yarn workspace declarations while rejecting outside and linked members', async () => {
    const monorepo = await fixture('studio', { name: 'studio', workspaces: { packages: ['apps/{web,admin}', '../outside', '/outside'] } })
    await fixture('studio/apps/web', { name: 'web' })
    const outside = await fixture('outside', { name: 'outside' })
    await symlink(outside, path.join(monorepo, 'apps/admin'))
    expect((await scanDirectory(monorepo)).result.projects.map(project => project.name).sort()).toEqual(['studio', 'web'])
  })

  it('reads metadata and real git history without executing project scripts', async () => {
    const directory = await fixture('hello', {
      name: '@studio/hello', version: '1.2.3', author: { name: 'Ada' },
      description: 'Package fallback', dependencies: { react: '^19', vite: '^7' },
      homepage: 'https://example.github.io/hello/#welcome',
      localRepos: { previewUrl: 'https://hello.example.test/demo' },
      scripts: { dev: 'node this-must-never-run.js' },
    })
    await writeFile(path.join(directory, 'README.md'), '# Hello\n\nA small project for curious people.\n\n## Install\n\nnpm install')
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    await execFileAsync('git', ['init', '-b', 'fixture-main'], { cwd: directory })
    await execFileAsync('git', ['add', '.'], { cwd: directory })
    await execFileAsync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-m', 'Create fixture project'], { cwd: directory })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/hello.git'], { cwd: directory })
    await writeFile(path.join(directory, 'untracked.txt'), 'A local edit')
    const { result } = await scanDirectory(root)
    expect(result.rootPath).toBe(await realpath(root))
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]).toMatchObject({
      name: '@studio/hello', version: '1.2.3', author: 'Ada',
      homepage: 'https://example.github.io/hello/#welcome', previewUrl: 'https://hello.example.test/demo',
      description: 'A small project for curious people.', relativePath: 'hello', packageManager: 'pnpm',
      dependencies: [
        { name: 'react', version: '^19', kind: 'dependencies' },
        { name: 'vite', version: '^7', kind: 'dependencies' },
      ],
      dev: { status: 'stopped' },
      git: { branch: 'fixture-main', message: 'Create fixture project', origin: 'https://github.com/example/hello', dirty: true },
    })
    expect(result.projects[0].git?.commit).toMatch(/^[a-f\d]{40}$/)
    expect(result.projects[0].stack).toContain('React')
    expect((await scanDirectory(root)).result.projects[0].id).toBe(result.projects[0].id)
  })

  it('skips hidden folders, node_modules, symlinked projects, deep projects, and outside metadata', async () => {
    const outside = path.join(temporary, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'package.json'), '{"name":"outside"}')
    await writeFile(path.join(outside, 'README.md'), 'Private outside data')
    const allowed = await fixture('allowed', { name: 'Allowed', description: 'Safe fallback' })
    await symlink(path.join(outside, 'README.md'), path.join(allowed, 'README.md'))
    await symlink(outside, path.join(root, 'linked'))
    await fixture('.hidden')
    await fixture('node_modules')
    await fixture('group/nested/too-deep')
    const { result } = await scanDirectory(root)
    expect(result.projects.map((project) => project.name)).toEqual(['Allowed'])
    expect(result.projects[0].description).toBe('Safe fallback')
    expect(result.projects[0].readme).toBeUndefined()
  })

  it('finds grouped repositories and non-JavaScript projects up to two levels deep', async () => {
    await fixture('group/nested', { name: 'Nested' })
    const python = path.join(root, 'python-project')
    await mkdir(python)
    await writeFile(path.join(python, 'pyproject.toml'), '[project]\nname = "python-project"')
    await writeFile(path.join(root, 'README.md'), '# My collection')
    const { result } = await scanDirectory(root)
    expect(result.projects.map((project) => project.relativePath)).toEqual(['group/nested', 'python-project'])
    expect(result.projects[1].stack).toContain('Python')
    expect(result.projects[1].dependencies).toEqual([])
  })

  it('supports selecting one repository and survives malformed metadata', async () => {
    const directory = await fixture('broken')
    await writeFile(path.join(directory, 'package.json'), '{not json')
    await writeFile(path.join(directory, 'readme.MD'), '# Broken\n\nStill a useful project.')
    const { result } = await scanDirectory(directory)
    expect(result.projects[0]).toMatchObject({ name: 'broken', relativePath: '.', description: 'Still a useful project.' })
    expect(result.warnings).toEqual(['broken: package.json could not be parsed.'])
  })

  it('ignores oversized metadata and rejects invalid input paths', async () => {
    const directory = await fixture('large')
    await writeFile(path.join(directory, 'package.json'), ' '.repeat(300_000))
    expect((await scanDirectory(root)).result.projects[0].name).toBe('large')
    await expect(scanDirectory('../relative')).rejects.toThrow('absolute')
    await expect(scanDirectory(null)).rejects.toThrow('absolute')
    await expect(scanDirectory(path.join(root, 'missing'))).rejects.toThrow('does not exist')
    expect(isWithin(root, `${root}-sibling`)).toBe(false)
  })

  it('reports truncation when grouped folders exceed the shared scan budget', async () => {
    await Promise.all(Array.from({ length: 6 }, async (_, group) => {
      const groupDirectory = path.join(root, `group-${group}`)
      await mkdir(groupDirectory)
      await Promise.all(Array.from({ length: 90 }, (_, child) => mkdir(path.join(groupDirectory, `folder-${child}`))))
    }))
    const { result } = await scanDirectory(root)
    expect(result.projects).toEqual([])
    expect(result.warnings?.some((warning) => warning.includes('limited to 500 folders'))).toBe(true)
  })
})

describe('registered project paths', () => {
  it('rejects unknown ids and a registered directory replaced by an outside symlink', async () => {
    const directory = await fixture('safe')
    const { registered } = await scanDirectory(root)
    const registry = new ProjectRegistry()
    registry.register(registered)
    await expect(registry.get('not-registered')).rejects.toThrow('not found')
    await rename(directory, path.join(temporary, 'moved'))
    await symlink(path.join(temporary, 'moved'), directory)
    await expect(registry.get(registered[0].project.id)).rejects.toThrow('path changed')
  })

  it('preserves live status references across a rescan', async () => {
    await fixture('active')
    const registry = new ProjectRegistry()
    const first = (await scanDirectory(root)).registered
    registry.register(first)
    first[0].project.dev = { status: 'running', url: 'http://127.0.0.1:4567' }
    first[0].project.screenshot = 'data:image/jpeg;base64,capture'
    first[0].project.preview = { source: 'github', url: 'https://demo.example.test/', capturedAt: '2026-10-07T12:00:00Z' }
    const outdated = { manager: 'npm' as const, scannedAt: '2026-10-07T12:00:00Z', findings: [], score: 0, level: 'current' as const }
    first[0].project.outdated = outdated
    const second = (await scanDirectory(root)).registered
    registry.register(second)
    expect(second[0].project.dev?.status).toBe('running')
    expect(second[0].project.screenshot).toBe('data:image/jpeg;base64,capture')
    expect(second[0].project.preview).toEqual({ source: 'github', url: 'https://demo.example.test/', capturedAt: '2026-10-07T12:00:00Z' })
    expect(second[0].project.outdated).toEqual(outdated)
    first[0].project.outdated = { ...outdated, scannedAt: '2026-10-08T12:00:00Z' }
    expect(registry.lookup(first[0].project.id).project.outdated?.scannedAt).toBe('2026-10-08T12:00:00Z')
    first[0].project.dev = { status: 'stopped' }
    expect((await registry.get(first[0].project.id)).project.dev?.status).toBe('stopped')
  })
})
