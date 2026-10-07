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
    const second = (await scanDirectory(root)).registered
    registry.register(second)
    expect(second[0].project.dev?.status).toBe('running')
    expect(second[0].project.screenshot).toBe('data:image/jpeg;base64,capture')
    expect(second[0].project.preview).toEqual({ source: 'github', url: 'https://demo.example.test/', capturedAt: '2026-10-07T12:00:00Z' })
    first[0].project.dev = { status: 'stopped' }
    expect((await registry.get(first[0].project.id)).project.dev?.status).toBe('stopped')
  })
})
