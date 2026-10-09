import { describe, expect, it, vi } from 'vitest'
import { canReadDirectory, scanDirectory } from './filesystem'

type Tree = { [name: string]: string | Tree }

function directory(name: string, tree: Tree): FileSystemDirectoryHandle {
  const entries = Object.entries(tree).map(([entryName, value]) => typeof value === 'string' ? {
    kind: 'file', name: entryName,
    getFile: async () => ({
      size: value.length,
      lastModified: 1700000000000,
      slice: (start: number, end?: number) => ({ text: async () => value.slice(start, end) }),
    }),
  } : directory(entryName, value))
  const get = (entryName: string, kind: string) => {
    const entry = entries.find((candidate) => candidate.name === entryName)
    if (!entry) throw new DOMException('Missing entry', 'NotFoundError')
    if (entry.kind !== kind) throw new DOMException('Wrong entry type', 'TypeMismatchError')
    return entry
  }
  return {
    kind: 'directory', name,
    async *values() { yield* entries },
    getFileHandle: async (entryName: string) => get(entryName, 'file'),
    getDirectoryHandle: async (entryName: string) => get(entryName, 'directory'),
    queryPermission: async () => 'granted',
  } as unknown as FileSystemDirectoryHandle
}

describe('read-only folder scan', () => {
  it.each(['AGENTS.md', 'AGENTS.m', 'CLAUDE.md'])('detects a root %s file without reading its content', async filename => {
    const root = directory('assisted', { 'package.json': '{}', [filename]: '' })
    const marker = await root.getFileHandle(filename)
    marker.getFile = vi.fn().mockRejectedValue(new Error('File contents must not be read'))
    expect((await scanDirectory(root)).projects[0].aiInstructionFiles).toEqual([filename])
    expect(marker.getFile).not.toHaveBeenCalled()
  })

  it('keeps AI markers local to each project root and ignores directories with marker names', async () => {
    const root = directory('studio', {
      'package.json': JSON.stringify({ name: 'studio', workspaces: ['apps/*'] }),
      'AGENTS.md': '', 'CLAUDE.md': '',
      apps: { web: { 'package.json': '{"name":"web"}', 'AGENTS.md': {}, docs: { 'CLAUDE.md': '' } } },
    })
    const result = await scanDirectory(root)
    expect(result.projects.find(project => project.name === 'studio')?.aiInstructionFiles).toEqual(['AGENTS.md', 'CLAUDE.md'])
    expect(result.projects.find(project => project.name === 'web')?.aiInstructionFiles).toEqual([])
    expect((await scanDirectory(directory('studio', { 'package.json': '{}' }))).projects[0].aiInstructionFiles).toEqual([])
  })

  it.each(['npm', 'pnpm'])('discovers %s workspace apps below repository boundaries', async manager => {
    const result = await scanDirectory(directory('Projects', { studio: {
      'package.json': JSON.stringify({ name: 'studio', packageManager: `${manager}@10.0.0`, ...(manager === 'npm' ? { workspaces: ['apps/*', '!apps/ignored'] } : {}) }),
      ...(manager === 'pnpm' ? { 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - "!apps/ignored"' } : {}),
      apps: { web: { 'package.json': '{"name":"web","scripts":{"dev":"vite"}}' }, admin: { 'package.json': '{"name":"admin","scripts":{"dev":"next dev"}}' }, ignored: { 'package.json': '{}' } },
      examples: { 'package.json': '{}' },
    } }))
    expect(result.projects.map(project => project.name)).toEqual(['admin', 'examples', 'studio', 'web'])
    expect(result.projects.find(project => project.name === 'studio')?.workspacePackageCount).toBe(3)
    expect(result.projects.find(project => project.name === 'web')).toMatchObject({ packageManager: manager, relativePath: 'studio/apps/web', scripts: { dev: 'vite' }, monorepo: { name: 'studio', packagePath: 'apps/web', declaredWorkspace: true } })
    expect(result.projects.find(project => project.name === 'examples')).toMatchObject({ packageManager: 'npm', monorepo: { name: 'studio', packagePath: 'examples', declaredWorkspace: false } })
  })

  it('discovers projects and immediate package children while ignoring dependencies and deep folders', async () => {
    const root = directory('Projects', {
      web: {
        'package.json': JSON.stringify({ name: 'web-app', version: '1.0.0', author: 'Ada', homepage: 'https://web.example.test/app/#welcome', localRepos: { previewUrl: 'https://preview.example.test/demo' }, scripts: { dev: 'vite' }, dependencies: { react: '^19' } }),
        'README.md': '# Web\n\nA home for local projects.',
        'pnpm-lock.yaml': '', 'components.json': '{}',
        child: { 'package.json': '{"name":"inside-app"}' },
      },
      clients: { api: { 'pyproject.toml': '[project]', 'README.md': '## API\n\nA small Python service.' } },
      node_modules: { dependency: { 'package.json': '{}' } },
      '.cache': { hidden: { 'package.json': '{}' } },
      archive: { year: { tooDeep: { 'package.json': '{}' } } },
    })
    const result = await scanDirectory(root)
    expect(result.rootName).toBe('Projects')
    expect(result.projects.map((project) => project.relativePath)).toEqual(['clients/api', 'web/child', 'web'])
    expect(result.projects[2]).toMatchObject({
      id: 'browser:Projects/web', name: 'web-app', author: 'Ada', version: '1.0.0',
      homepage: 'https://web.example.test/app/#welcome', previewUrl: 'https://preview.example.test/demo',
      description: 'A home for local projects.', stack: ['React', 'shadcn/ui'],
      packageManager: 'pnpm', scripts: { dev: 'vite' },
      dependencies: [{ name: 'react', version: '^19', kind: 'dependencies' }],
    })
    expect(result.projects[0].stack).toEqual(['Python'])
    expect(result.projects[0].dependencies).toEqual([])
  })

  it.each(['.git', 'pyproject.toml'])('discovers package children under a %s project without a root manifest', async marker => {
    const root = directory('Projects', { clients: { service: {
      [marker]: marker === '.git' ? { HEAD: 'ref: refs/heads/main\n' } : '[project]',
      frontend: { 'package.json': '{"name":"frontend","packageManager":"pnpm@10.0.0"}' },
      node_modules: { 'package.json': '{}' },
      '.hidden': { 'package.json': '{}' },
      examples: { deep: { 'package.json': '{"name":"too-deep"}' } },
    } } })
    const result = await scanDirectory(root)
    expect(result.projects.map(project => project.name)).toEqual(['frontend', 'service'])
    expect(result.projects[0]).toMatchObject({
      relativePath: 'clients/service/frontend', packageManager: 'pnpm',
      monorepo: { id: 'browser:Projects/clients/service', name: 'service', relativePath: 'clients/service', packagePath: 'frontend', declaredWorkspace: false },
    })
    expect(result.projects[1]).toMatchObject({ hasPackageJson: false, workspacePackageCount: 1 })
    if (marker === '.git') expect(result.projects[0].git).toMatchObject({ branch: 'main' })
  })

  it('stops automatic discovery after one level even when a child declares workspaces', async () => {
    const result = await scanDirectory(directory('studio', {
      'package.json': '{"name":"studio"}',
      frontend: {
        'package.json': JSON.stringify({ name: 'frontend', workspaces: ['packages/*'] }),
        'pnpm-workspace.yaml': 'packages:\n  - packages/*',
        nested: { 'package.json': '{"name":"nested"}' },
        packages: { ui: { 'package.json': '{"name":"ui"}' } },
      },
      apps: { web: { 'package.json': '{"name":"web"}' } },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['frontend', 'studio'])
    expect(result.projects[0].monorepo).toMatchObject({ relativePath: '.', packagePath: 'frontend', declaredWorkspace: false })
  })

  it('retains nested declared workspaces without starting another level of automatic discovery', async () => {
    const result = await scanDirectory(directory('studio', {
      'package.json': JSON.stringify({ name: 'studio', workspaces: ['apps/*'] }),
      apps: { web: {
        'package.json': JSON.stringify({ name: 'web', workspaces: ['packages/*'] }),
        packages: { ui: { 'package.json': '{"name":"ui"}', internal: { 'package.json': '{"name":"too-deep"}' } } },
        undeclared: { 'package.json': '{"name":"undeclared"}' },
      } },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['studio', 'ui', 'web'])
    expect(result.projects[1].monorepo).toMatchObject({ name: 'web', packagePath: 'packages/ui', declaredWorkspace: true })
  })

  it('keeps root workspace discovery through an implicit package without adopting its declarations', async () => {
    const result = await scanDirectory(directory('studio', {
      'package.json': JSON.stringify({ name: 'studio', packageManager: 'pnpm@10.0.0', workspaces: ['apps/*'] }),
      apps: {
        'package.json': JSON.stringify({ name: 'apps', packageManager: 'bun@1.0.0', workspaces: ['unrelated/**'] }),
        web: { 'package.json': '{"name":"web","packageManager":"npm@10.0.0"}' },
        other: { deep: { 'package.json': '{"name":"too-deep"}' } },
        unrelated: { nested: { 'package.json': '{"name":"unrelated"}' } },
      },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['apps', 'studio', 'web'])
    expect(result.projects[0]).toMatchObject({
      packageManager: 'bun', monorepo: { id: 'browser:studio/.', name: 'studio', packagePath: 'apps', declaredWorkspace: false },
    })
    expect(result.projects[2]).toMatchObject({
      packageManager: 'pnpm', monorepo: { id: 'browser:studio/.', name: 'studio', packagePath: 'apps/web', declaredWorkspace: true },
    })
    expect(result.projects[1].workspacePackageCount).toBe(2)
  })

  it('includes undeclared and explicitly excluded direct packages with their own package managers', async () => {
    const result = await scanDirectory(directory('studio', {
      'package.json': JSON.stringify({ name: 'studio', packageManager: 'pnpm@10.0.0', workspaces: ['*', '!excluded'] }),
      declared: { 'package.json': '{"name":"declared","packageManager":"npm@10.0.0"}' },
      excluded: { 'package.json': '{"name":"excluded"}', 'bun.lock': '' },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['declared', 'excluded', 'studio'])
    expect(result.projects[0]).toMatchObject({ packageManager: 'pnpm', monorepo: { declaredWorkspace: true } })
    expect(result.projects[1]).toMatchObject({ packageManager: 'bun', monorepo: { declaredWorkspace: false } })
  })

  it('discovers immediate packages when workspace declarations cannot be parsed', async () => {
    const result = await scanDirectory(directory('studio', {
      'package.json': '{"name":"studio"}',
      'pnpm-workspace.yaml': 'packages: [invalid',
      frontend: { 'package.json': '{"name":"frontend"}' },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['frontend', 'studio'])
    expect(result.projects[0].monorepo?.declaredWorkspace).toBe(false)
    expect(result.warnings).toEqual(['.: workspace declarations could not be read.'])
  })

  it('keeps immediate nested Git repositories standalone without inheriting Git or scanning deeper', async () => {
    const result = await scanDirectory(directory('studio', {
      '.git': { HEAD: 'ref: refs/heads/main\n' },
      'package.json': JSON.stringify({ name: 'studio', packageManager: 'pnpm@10.0.0', workspaces: ['*'] }),
      independent: {
        '.git': { HEAD: 'ref: refs/heads/independent\n' },
        'package.json': '{"name":"independent","packageManager":"bun@1.0.0"}',
        frontend: { 'package.json': '{"name":"too-deep"}' },
      },
      linked: { '.git': 'gitdir: ../elsewhere', 'package.json': '{"name":"linked"}' },
      gitOnly: { '.git': { HEAD: 'ref: refs/heads/other\n' } },
    }))
    expect(result.projects.map(project => project.name)).toEqual(['gitOnly', 'independent', 'linked', 'studio'])
    expect(result.projects[1]).toMatchObject({ packageManager: 'bun', git: { branch: 'independent' } })
    expect(result.projects[2].git).toBeUndefined()
    expect(result.projects.every(project => project.monorepo === undefined)).toBe(true)
    expect(result.projects[3].workspacePackageCount).toBeUndefined()
  })

  it('reads packed branch refs and current commit metadata for a selected repository', async () => {
    const commit = 'b'.repeat(40)
    const root = directory('my-repo', {
      '.git': {
        HEAD: 'ref: refs/heads/main\n',
        'packed-refs': '# pack-refs\n' + commit + ' refs/heads/main\n',
        config: '[remote "origin"]\nurl = git@github.com:ada/my-repo.git\n',
        logs: { HEAD: 'a'.repeat(40) + ' ' + commit + ' Ada <ada@example.test> 1700000000 +0100\tcommit: Initial view\n' },
      },
      'README.md': '# My Repo\n\nA project without a package file.',
    })
    const result = await scanDirectory(root)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]).toMatchObject({
      relativePath: '.', name: 'my-repo',
      git: { branch: 'main', commit, message: 'Initial view', committedAt: '2023-11-14T22:13:20.000Z', origin: 'https://github.com/ada/my-repo' },
    })
  })

  it('retains a malformed-package project and reports linked-worktree limitations', async () => {
    const result = await scanDirectory(directory('Projects', {
      broken: { 'package.json': '{broken', 'README.md': 'Useful description.', '.git': 'gitdir: ../other/.git/worktrees/broken' },
    }))
    expect(result.projects[0]).toMatchObject({ name: 'broken', description: 'Useful description.' })
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings?.join(' ')).toContain('Linked worktree')
  })

  it('queries saved permission without prompting and only requests it when asked', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    const handle = { queryPermission: async () => 'prompt', requestPermission } as unknown as FileSystemDirectoryHandle
    expect(await canReadDirectory(handle)).toBe(false)
    expect(requestPermission).not.toHaveBeenCalled()
    expect(await canReadDirectory(handle, true)).toBe(true)
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' })
    await expect(scanDirectory(handle)).rejects.toThrow('Folder access has expired')
  })
})
