import { describe, expect, it } from 'vitest'
import type { RepoProject } from '@/types'
import { createConfigBackup, mergeConfigProjects, parseConfigBackup } from './config-backup'
import { defaultSettings } from './settings'

it('round-trips application preferences and accepts older backups while rejecting invalid choices', () => {
  const backup = createConfigBackup({ ...defaultSettings, editor: 'zed', gitClient: 'gitkraken', terminal: 'ghostty' }, 'system', [], [], {})
  expect(parseConfigBackup(JSON.stringify(backup)).settings).toMatchObject({ editor: 'zed', gitClient: 'gitkraken', terminal: 'ghostty' })
  expect(() => parseConfigBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, terminal: 'arbitrary-command' } }))).toThrow('invalid setting: terminal')
  const { editor: _editor, gitClient: _gitClient, terminal: _terminal, ...legacy } = backup.settings
  expect(parseConfigBackup(JSON.stringify({ ...backup, settings: legacy })).settings).toMatchObject({ editor: 'vscode', gitClient: 'sourcetree', terminal: 'auto' })
  expect(() => parseConfigBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, editor: 'arbitrary-command' } }))).toThrow('invalid setting: editor')
})

const project = (id: string, relativePath = id, origin?: string, packagePath?: string): RepoProject => ({
  id, relativePath, name: 'Same display name', dirName: relativePath.split('/').at(-1)!, description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '',
  ...(origin ? { git: { origin } } : {}),
  ...(packagePath ? { monorepo: { id: 'root', name: 'Workspace', relativePath: 'root', packagePath } } : {}),
})
const exportConfig = (projects: RepoProject[], favorites = projects.map(p => p.id), tags = {}) => createConfigBackup({ ...defaultSettings, colorScheme: 'ocean' }, 'dark', projects, favorites, tags)

describe('portable configuration', () => {
  it('round-trips all settings, theme, favorites and normalized tags without project data or credentials', () => {
    const source = { ...project('local', 'app', 'https://user:secret@github.com/team/app.git?token=secret'), scripts: { dev: 'secret command' }, screenshot: 'large image', readme: 'readme content' }
    const backup = exportConfig([source], ['local', 'absent'], { local: ['Work', 'work', ' Private '], absent: ['saved'] })
    const text = JSON.stringify(backup)
    const parsed = parseConfigBackup(text)
    expect(parsed).toEqual(backup)
    expect(parsed.settings).toEqual({ ...defaultSettings, colorScheme: 'ocean' })
    expect(parsed.theme).toBe('dark')
    expect(parsed.projects).toEqual([
      { id: 'local', relativePath: 'app', packagePath: '', origin: 'https://github.com/team/app', favorite: true, tags: ['private', 'work'] },
      { id: 'absent', favorite: true, tags: ['saved'] },
    ])
    for (const excluded of ['secret', 'scripts', 'screenshot', 'readme']) expect(text).not.toContain(excluded)
    expect(parseConfigBackup('\uFEFF' + text)).toEqual(backup)
  })

  it('merges moved checkouts and changed connection methods while preserving additional and existing preferences', () => {
    const backup = exportConfig([
      project('old-alpha', 'old-folder', 'git@github.com:team/alpha.git'), project('old-beta', 'group/beta'), project('missing'),
    ], ['old-alpha', 'old-beta', 'missing'], { 'old-alpha': ['work'], 'old-beta': ['private'] })
    const destination = [project('new-alpha', 'renamed', 'https://github.com/team/alpha'), project('browser:Projects/group/beta', 'group/beta'), project('extra')]
    const favorites = ['extra']
    const tags = { 'new-alpha': ['local'], extra: ['untouched'] }
    const result = mergeConfigProjects(backup, destination, favorites, tags)
    expect(result).toEqual({ matched: 2, missing: 1, different: 0, ambiguous: 0,
      favorites: ['extra', 'new-alpha', 'browser:Projects/group/beta'],
      tags: { 'new-alpha': ['local', 'work'], 'browser:Projects/group/beta': ['private'], extra: ['untouched'] },
    })
    expect(mergeConfigProjects(backup, destination, result.favorites, result.tags)).toEqual(result)
    expect(favorites).toEqual(['extra'])
    expect(tags).toEqual({ 'new-alpha': ['local'], extra: ['untouched'] })
  })

  it('does not apply preferences to a different repository at the same ID or path', () => {
    const backup = exportConfig([project('same-id', 'app', 'https://github.com/team/original')], undefined, { 'same-id': ['work'] })
    const result = mergeConfigProjects(backup, [project('same-id', 'app', 'https://github.com/team/replacement')], [], {})
    expect(result).toEqual({ matched: 0, missing: 0, ambiguous: 0, different: 1, favorites: [], tags: {} })
    // A relocated original takes precedence over a different repo occupying its old path.
    expect(mergeConfigProjects(backup, [project('same-id', 'app', 'https://github.com/team/replacement'), project('moved', 'elsewhere', 'https://github.com/team/original')], [], {}).favorites).toEqual(['moved'])
  })

  it('separates monorepo roots and members by package path, even when the checkout moves', () => {
    const origin = 'https://github.com/team/mono'
    const backup = exportConfig([project('root', 'mono', origin), project('web', 'mono/apps/web', origin, 'apps/web'), project('lib', 'mono/packages/lib', origin, 'packages/lib')], ['web'], { root: ['root'], web: ['frontend'], lib: ['library'] })
    const result = mergeConfigProjects(backup, [project('new-root', 'renamed', origin), project('new-web', 'renamed/apps/web', origin, 'apps/web'), project('new-lib', 'renamed/packages/lib', origin, 'packages/lib')], [], {})
    expect(result.matched).toBe(3)
    expect(result.favorites).toEqual(['new-web'])
    expect(result.tags).toEqual({ 'new-root': ['root'], 'new-web': ['frontend'], 'new-lib': ['library'] })
  })

  it('skips ambiguous clones and colliding imports, using exact IDs or paths only when they disambiguate', () => {
    const origin = 'https://github.com/team/clone'
    const backup = exportConfig([project('old', 'original', origin)])
    const clones = [project('clone-a', 'a', origin), project('clone-b', 'b', origin)]
    expect(mergeConfigProjects(backup, clones, [], {})).toMatchObject({ matched: 0, ambiguous: 1, favorites: [] })
    expect(mergeConfigProjects(backup, [project('old', 'a', origin), clones[1]], [], {}).favorites).toEqual(['old'])
    expect(mergeConfigProjects(backup, [project('clone-a', 'original', origin), clones[1]], [], {}).favorites).toEqual(['clone-a'])
    expect(mergeConfigProjects(exportConfig(clones), [project('new', 'a', origin)], [], {})).toMatchObject({ matched: 0, ambiguous: 2, favorites: [] })
  })

  it('handles empty destinations, orphaned IDs, false favorites, and prototype-like identifiers', () => {
    const backup = exportConfig([project('__proto__')], [], JSON.parse('{"__proto__":["work"]}'))
    expect(mergeConfigProjects(backup, [], ['local'], { local: ['keep'] })).toMatchObject({ missing: 1, favorites: ['local'], tags: { local: ['keep'] } })
    const result = mergeConfigProjects(backup, [project('__proto__')], ['__proto__'], {})
    expect(result.tags['__proto__']).toEqual(['work'])
    expect(result.favorites).toEqual(['__proto__'])
    expect({}).not.toHaveProperty('work')
    const orphan = exportConfig([], ['orphan'], { orphan: ['saved'] })
    expect(mergeConfigProjects(orphan, [project('orphan')], [], {}).tags).toEqual({ orphan: ['saved'] })
  })

  it('rejects invalid JSON, unsupported formats, corrupt preferences, and unsafe settings before import', () => {
    const backup = exportConfig([project('alpha')])
    expect(() => parseConfigBackup('{')).toThrow('not valid JSON')
    for (const value of [null, [], {}, { ...backup, format: 'another-app' }]) expect(() => parseConfigBackup(JSON.stringify(value))).toThrow('Local Repos')
    expect(() => parseConfigBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow('version')
    for (const patch of [
      { theme: 'blue' }, { settings: [] }, { settings: { ...defaultSettings, statusPollSeconds: -1 } },
      { settings: { ...defaultSettings, outdatedOrangeScore: 200 } }, { settings: { auditColors: { critical: 'green' } } },
      { projects: [backup.projects[0], backup.projects[0]] }, { projects: [{ ...backup.projects[0], tags: ['x'.repeat(41)] }] },
      { projects: [{ ...backup.projects[0], tags: 'work' }] }, { projects: [{ ...backup.projects[0], favorite: 'yes' }] },
      { projects: [{ ...backup.projects[0], origin: 'javascript:alert(1)' }] },
    ]) expect(() => parseConfigBackup(JSON.stringify({ ...backup, ...patch }))).toThrow()
  })
})
