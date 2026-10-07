import { describe, expect, it } from 'vitest'
import { extractReadmeIntro, normalizeGitOrigin, normalizePreviewUrl, parseGitConfig, parseGitHead, parseGitLog, parsePackageJson } from './metadata'

describe('package metadata', () => {
  it('extracts typed fields, authors, scripts and frameworks across dependency groups', () => {
    expect(parsePackageJson(JSON.stringify({
      name: '@studio/site', version: '0.2.1', author: { name: 'Ada Lovelace' },
      license: 'MIT', packageManager: 'pnpm@10.0.0', description: 'A useful project',
      scripts: { dev: 'vite', build: 'vite build', invalid: 123 },
      dependencies: { react: '^19', 'react-dom': '^19' },
      devDependencies: { vite: '^7', typescript: '^5', tailwindcss: '^4' },
    }))).toEqual({
      name: '@studio/site', version: '0.2.1', author: 'Ada Lovelace', license: 'MIT',
      description: 'A useful project', packageManager: 'pnpm',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: [
        { name: 'react', version: '^19', kind: 'dependencies' },
        { name: 'react-dom', version: '^19', kind: 'dependencies' },
        { name: 'tailwindcss', version: '^4', kind: 'devDependencies' },
        { name: 'typescript', version: '^5', kind: 'devDependencies' },
        { name: 'vite', version: '^7', kind: 'devDependencies' },
      ],
      stack: ['React', 'TypeScript', 'Vite', 'Tailwind CSS'],
    })
  })

  it('rejects malformed packages and tolerates missing or wrong-typed optional fields', () => {
    expect(() => parsePackageJson('{broken')).toThrow()
    expect(() => parsePackageJson('null')).toThrow()
    expect(parsePackageJson('{"name":42,"scripts":null,"dependencies":["react"]}')).toMatchObject({
      name: undefined, scripts: {}, dependencies: [], stack: [], packageManager: 'npm',
    })
  })

  it('preserves declared version specs and distinct groups, including peers and optional packages', () => {
    const metadata = parsePackageJson(JSON.stringify({
      dependencies: { react: 'npm:preact@^10', shared: 'workspace:*', invalid: 42, '': '^1' },
      devDependencies: { react: '^19.0.0' },
      peerDependencies: { react: '>=18 <20' },
      optionalDependencies: { '@tauri-apps/api': 'file:../tauri', invalid: null },
    }))
    expect(metadata.dependencies).toEqual([
      { name: 'react', version: 'npm:preact@^10', kind: 'dependencies' },
      { name: 'shared', version: 'workspace:*', kind: 'dependencies' },
      { name: 'react', version: '^19.0.0', kind: 'devDependencies' },
      { name: 'react', version: '>=18 <20', kind: 'peerDependencies' },
      { name: '@tauri-apps/api', version: 'file:../tauri', kind: 'optionalDependencies' },
    ])
    expect(metadata.stack).toEqual(['React', 'Tauri'])
  })

  it('reads app URLs while preserving their route, query and hash', () => {
    expect(parsePackageJson(JSON.stringify({
      homepage: 'https://studio.github.io/demo/gallery?theme=light#/project/one',
      localRepos: { previewUrl: 'http://localhost:4242/demo?preview=1#screen' },
    }))).toMatchObject({
      homepage: 'https://studio.github.io/demo/gallery?theme=light#/project/one',
      previewUrl: 'http://localhost:4242/demo?preview=1#screen',
    })
  })

  it.each([
    undefined, 123, '', '.', '/demo/', 'demo.example.com', 'javascript:alert(1)',
    'file:///tmp/example.html', 'https:example.com', 'https:///example.com',
    'https://user:secret@example.com/demo', 'https://example.com\\demo',
    'https://exa\nmple.com', 'https://github.com/studio/repo',
    'https://www.gitlab.com/studio/repo', 'https://bitbucket.org/studio/repo',
  ])('ignores unsafe, relative or repository URLs: %s', (url) => {
    expect(normalizePreviewUrl(url)).toBeUndefined()
    expect(parsePackageJson(JSON.stringify({ homepage: url, localRepos: { previewUrl: url } }))).toMatchObject({
      homepage: undefined, previewUrl: undefined,
    })
  })
})

describe('README introduction', () => {
  it('skips frontmatter, heading, badges, code and extracts readable prose', () => {
    const markdown = [
      '---', 'title: Test', '---', '# Project', '',
      '[![Build](badge.svg)](https://example.test)', '<!-- internal note -->', '',
      '~~~sh', 'npm install', '~~~', '',
      'A **small** app for [local projects](https://example.test).',
      'Built with React &amp; care.', '', '## Installation', 'Run npm install.',
    ].join('\n')
    expect(extractReadmeIntro(markdown)).toBe('A small app for local projects. Built with React & care.')
  })

  it('skips setext headings and bounds long text without taking setup commands', () => {
    expect(extractReadmeIntro('Project\n=======\n\nHelpful overview.\n\n- npm install')).toBe('Helpful overview.')
    expect(extractReadmeIntro('# Project\n\n- npm install\n\n~~~sh\nnpm run dev\n~~~')).toBe('')
    expect(extractReadmeIntro('A very long description '.repeat(30), 80).length).toBeLessThanOrEqual(80)
  })
})

describe('Git metadata', () => {
  it('supports branch names with slashes and detached heads', () => {
    expect(parseGitHead('ref: refs/heads/feature/new-ui\n')).toEqual({ branch: 'feature/new-ui' })
    const commit = 'a'.repeat(40)
    expect(parseGitHead(commit + '\n')).toEqual({ branch: 'detached', commit })
  })

  it('extracts origin only, normalizes SSH and strips URL credentials', () => {
    expect(parseGitConfig('[remote "upstream"]\n url = https://example.com/upstream.git\n[remote "origin"]\n url = git@github.com:studio/project.git')).toBe('https://github.com/studio/project')
    expect(normalizeGitOrigin('https://secret:password@github.com/studio/project.git')).toBe('https://github.com/studio/project')
    expect(normalizeGitOrigin('ssh://git@gitlab.com/studio/project.git')).toBe('https://gitlab.com/studio/project')
    expect(normalizeGitOrigin('/Users/ada/project.git')).toBeUndefined()
  })

  it('finds the current commit event rather than presenting a checkout as a commit', () => {
    const old = 'a'.repeat(40)
    const current = 'b'.repeat(40)
    const log = old + ' ' + current + ' Ada Lovelace <ada@example.com> 1700000000 +0100\tcommit: Add workspace scan\n'
      + current + ' ' + current + ' Ada Lovelace <ada@example.com> 1700000010 +0100\tcheckout: moving from main to feature\n'
    expect(parseGitLog(log, current)).toEqual({ commit: current, message: 'Add workspace scan', committedAt: '2023-11-14T22:13:20.000Z' })
    expect(parseGitLog(log, old)).toEqual({})
    expect(parseGitLog(old + ' ' + current + ' Ada <ada@example.com> 1700000000 +0100\tcheckout: moving')).toEqual({})
  })
})
