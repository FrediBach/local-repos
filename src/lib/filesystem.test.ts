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
  it('discovers projects and grouped repos, ignores dependencies and stops at project boundaries', async () => {
    const root = directory('Projects', {
      web: {
        'package.json': JSON.stringify({ name: 'web-app', version: '1.0.0', author: 'Ada', scripts: { dev: 'vite' }, dependencies: { react: '^19' } }),
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
    expect(result.projects.map((project) => project.relativePath)).toEqual(['clients/api', 'web'])
    expect(result.projects[1]).toMatchObject({
      id: 'browser:Projects/web', name: 'web-app', author: 'Ada', version: '1.0.0',
      description: 'A home for local projects.', stack: ['React', 'shadcn/ui'],
      packageManager: 'pnpm', scripts: { dev: 'vite' },
    })
    expect(result.projects[0].stack).toEqual(['Python'])
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
