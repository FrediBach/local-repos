import { describe, expect, it } from 'vitest'
import type { RepoProject } from '../types'
import { commandMatchScore, commandTemplates, prepareCommandFields, prepareCommandQuery, preparedCommandMatchScore, projectCommands } from './project-commands'
import { defaultSettings } from './settings'

const project: RepoProject = {
  id: 'website', name: 'Café Website', dirName: 'website', relativePath: 'apps/website',
  description: 'The customer portal', packageManager: 'pnpm', hasPackageJson: true,
  scripts: { dev: 'vite', 'test:e2e': 'playwright test --ui', pretest: 'node setup.js', test: 'vitest run', prepare: 'husky' },
  stack: ['React', 'Vite'], scannedAt: '2026-10-09T10:00:00Z',
}

describe('project command catalog', () => {
  it('uses preferred desktop applications and launches only existing application targets', () => {
    const commands = projectCommands(project, { editor: 'zed', gitClient: 'fork' }, false)
    expect(commands.find(command => command.id === 'editor')).toMatchObject({ title: 'Open in Zed', helper: true, intent: { kind: 'action', name: 'open', body: { app: 'zed' } } })
    expect(commands.find(command => command.id === 'git-client')).toMatchObject({ title: 'Open in Fork', intent: { kind: 'action', name: 'open', body: { app: 'fork' } } })
    const folder = commands.find(command => command.id === 'folder')!
    expect(folder.intent).toEqual({ kind: 'action', name: 'open', body: { app: 'folder' } })
    for (const query of ['finder', 'explorer', 'open the project dir in finder']) {
      expect(commandMatchScore(query, [folder.title, folder.description, folder.keywords])).toBeDefined()
    }
  })

  it('offers every discovered script including the primary dev script, preserving exact launch payloads', () => {
    const commands = projectCommands(project, defaultSettings, false)
    const scripts = commands.filter(command => command.id.startsWith('script:'))
    expect(scripts.map(command => command.id)).toEqual(['script:dev', 'script:test', 'script:test:e2e'])
    expect(scripts.find(command => command.id === 'script:test:e2e')).toMatchObject({
      title: 'Run test:e2e', description: 'pnpm run test:e2e · playwright test --ui', helper: true,
      intent: { kind: 'action', name: 'run-script', body: { name: 'test:e2e', command: 'playwright test --ui' } },
    })
    const oddScript = projectCommands({ ...project, scripts: { "test's $(echo text)": 'node "check.mjs"' } }, defaultSettings, false).find(command => command.id.startsWith('script:'))!
    expect(oddScript.description).toBe('pnpm run \'test\'"\'"\'s $(echo text)\' · node "check.mjs"')
    expect(oddScript.intent).toEqual({ kind: 'action', name: 'run-script', body: { name: "test's $(echo text)", command: 'node "check.mjs"' } })
  })

  it('offers package checks only when the manifest is not explicitly absent, including older cached projects', () => {
    const plain = projectCommands({ ...project, hasPackageJson: false, stack: [], scripts: {} }, defaultSettings, false)
    expect(plain.some(command => ['audit', 'outdated', 'unused', 'update-packages', 'react-doctor', 'lighthouse', 'open-lighthouse', 'start', 'stop', 'logs'].includes(command.id))).toBe(false)
    expect(plain.find(command => command.id === 'storage')?.intent).toEqual({ kind: 'action', name: 'storage' })
    const older = projectCommands({ ...project, hasPackageJson: undefined }, defaultSettings, false)
    expect(older.filter(command => ['audit', 'outdated', 'unused'].includes(command.id))).toHaveLength(3)
  })

  it('recognizes peer-only React packages for React Doctor', () => {
    const commands = projectCommands({ ...project, stack: [], dependencies: [{ name: 'react', version: '^19.0.0', kind: 'peerDependencies' }] }, defaultSettings, false)
    expect(commands.find(command => command.id === 'react-doctor')?.intent).toEqual({ kind: 'action', name: 'react-doctor' })
  })

  it('offers Lighthouse for launchable frontends and explicitly configured URLs, but not React libraries', () => {
    expect(projectCommands(project, defaultSettings, false).find(command => command.id === 'lighthouse')?.intent).toEqual({ kind: 'action', name: 'lighthouse' })
    expect(projectCommands({ ...project, scripts: {} }, defaultSettings, false).some(command => command.id === 'lighthouse')).toBe(false)
    const custom = projectCommands({ ...project, scripts: { start: 'node server.js' }, previewUrl: 'http://localhost:3000/' }, defaultSettings, false)
    expect(custom.find(command => command.id === 'lighthouse')?.intent).toEqual({ kind: 'action', name: 'lighthouse' })
    expect(custom.find(command => command.id === 'open-lighthouse')).toMatchObject({ helper: false, intent: { kind: 'details', tab: 'lighthouse' } })
  })

  it.each(['running', 'starting'] as const)('offers stop instead of start for a %s server', status => {
    const commands = projectCommands({ ...project, dev: { status } }, defaultSettings, false)
    expect(commands.find(command => command.id === 'stop')?.intent).toEqual({ kind: 'action', name: 'stop' })
    expect(commands.some(command => command.id === 'start')).toBe(false)
    expect(commands.some(command => command.id === 'logs')).toBe(true)
    expect(projectCommands(project, defaultSettings, false).some(command => command.id === 'start')).toBe(true)
  })

  it('keeps package mutation and dependency deletion behind their existing detail controls', () => {
    const commands = projectCommands(project, defaultSettings, false)
    expect(commands.find(command => command.id === 'update-packages')).toMatchObject({ helper: false, intent: { kind: 'details', tab: 'packages' } })
    expect(commands.find(command => command.id === 'cleanup')).toMatchObject({ helper: false, intent: { kind: 'details', tab: 'overview' } })
    expect(commands.some(command => command.intent.kind === 'action' && ['update-packages', 'update-minor', 'update-patches', 'delete-node-modules'].includes(command.intent.name))).toBe(false)
  })

  it('keeps preferences and reading available without the helper, and adapts favorite labels', () => {
    const commands = projectCommands(project, defaultSettings, true)
    for (const id of ['tags', 'favorite', 'todos', 'details', 'readme', 'packages']) expect(commands.find(command => command.id === id)?.helper).toBe(false)
    expect(commands.find(command => command.id === 'tags')).toMatchObject({ title: 'Add or edit tags', intent: { kind: 'tags' } })
    expect(commands.find(command => command.id === 'favorite')).toMatchObject({ title: 'Remove favorite', intent: { kind: 'favorite' } })
    expect(commands.find(command => command.id === 'screenshot')).toMatchObject({ helper: true, intent: { kind: 'action', name: 'screenshot', body: { source: 'auto' } } })
  })

  it('gives every project command a unique ID and a matching action template', () => {
    const templates = commandTemplates(defaultSettings)
    const commands = projectCommands(project, defaultSettings, false)
    expect(new Set(templates.map(command => command.id)).size).toBe(templates.length)
    expect(new Set(commands.map(command => command.id)).size).toBe(commands.length)
    expect(commands.every(command => templates.some(template => template.id === (command.id.startsWith('script:') ? 'scripts' : command.id)))).toBe(true)
  })
})

describe('command matching', () => {
  it('matches queries across command and project metadata in either order', () => {
    const command = projectCommands(project, defaultSettings, false).find(item => item.id === 'audit')!
    const fields = [command.title, command.description, command.keywords, project.name, project.relativePath]
    expect(commandMatchScore('rerun the vulnerability check for cafe', fields)).toBeDefined()
    expect(commandMatchScore('café vulnerability', fields)).toBe(commandMatchScore('vulnerability café', fields))
    expect(commandMatchScore('vulnerability missing-repository', fields)).toBeUndefined()
  })

  it('ranks whole fields above exact words, prefixes, substrings, and bounded abbreviations', () => {
    expect(commandMatchScore('audit', ['audit'])).toBeGreaterThan(commandMatchScore('audit', ['run audit'])!)
    expect(commandMatchScore('audit', ['run audit'])).toBeGreaterThan(commandMatchScore('audit', ['auditing'])!)
    expect(commandMatchScore('audit', ['auditing'])).toBeGreaterThan(commandMatchScore('audit', ['preaudit'])!)
    expect(commandMatchScore('strg', ['storage'])).toBeDefined()
    expect(commandMatchScore('abc', ['arbitrarily big collection'])).toBeUndefined()
    expect(commandMatchScore('st', ['script terminal'])).toBeUndefined()
  })

  it('normalizes accents, case, punctuation, scoped packages, and script separators', () => {
    expect(commandMatchScore('CAFÉ', ['cafe'])).toBe(commandMatchScore('café', ['Café']))
    expect(commandMatchScore('rEaCt', ['REACT'])).toBeDefined()
    expect(commandMatchScore('test:e2e', ['Run test:e2e'])).toBeDefined()
    expect(commandMatchScore('test e2e ui', ['Run test:e2e', 'playwright test --ui'])).toBeDefined()
    expect(commandMatchScore('@types/react', ['dependencies @types/react'])).toBeDefined()
  })

  it('ignores fillers within a query but preserves a query consisting only of filler words', () => {
    expect(commandMatchScore('add a tag for the project', ['Add tags'])).toBeDefined()
    expect(commandMatchScore('project', ['Project details'])).toBeDefined()
    expect(commandMatchScore('project', ['Run test'])).toBeUndefined()
    expect(commandMatchScore('the', ['The'])).toBeDefined()
    expect(commandMatchScore('', [])).toBe(0)
    expect(commandMatchScore('   ', ['anything'])).toBe(0)
  })

  it.each([
    ['finder alpha', ['Open project folder', 'finder explorer dir'], ['Alpha', 'apps/alpha'], 120],
    ['alpha finder', ['Open project folder', 'finder explorer dir'], ['Alpha', 'apps/alpha'], 120],
    ['Run test', ['Run test'], ['Café Website'], 240],
    ['cafe', ['Run test'], ['Café'], 180],
    ['audit', ['auditing'], ['audit'], 180],
    ['run', ['Run test'], ['Run tests'], 70],
    ['the', ['The'], [], 180],
    ['absent', ['Run test'], ['Café'], undefined],
    ['', [], [], 0],
  ])('keeps prepared split fields equivalent for %s', (query, commandFields, projectFields, expected) => {
    const prepared = preparedCommandMatchScore(prepareCommandQuery(query), prepareCommandFields(commandFields), prepareCommandFields(projectFields))
    expect(prepared).toBe(expected)
    expect(commandMatchScore(query, [...commandFields, ...projectFields])).toBe(expected)
  })
})
