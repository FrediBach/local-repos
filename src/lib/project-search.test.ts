import { describe, expect, it } from 'vitest'
import type { RepoProject } from '../types'
import { projectFilterGroups } from './project-filters'
import { createProjectSearchIndex, searchSuggestions, type SearchSelection, type SearchSuggestion } from './project-search'
import { defaultSettings } from './settings'

const alpha: RepoProject = {
  id: 'alpha', name: 'Alpha', description: 'A customer dashboard', dirName: 'alpha', relativePath: 'apps/alpha',
  stack: ['React', 'TypeScript'], tags: ['client work'], git: { branch: 'feature/search', origin: 'https://github.com/example/alpha' },
  scripts: { dev: 'vite', build: 'vite build', 'test:watch': 'vitest --watch', 'refresh-data': 'node scripts/refresh.js', prebuild: 'echo setup', empty: '' },
  packageManager: 'npm', hasPackageJson: true, scannedAt: '2026-10-09T10:00:00Z',
  dependencies: [
    { name: 'react', version: '^19.0.0', kind: 'dependencies' },
    { name: '@acme/ui', version: '^2.3.0', kind: 'dependencies' },
    { name: 'internal', version: 'workspace:*', kind: 'dependencies' },
  ],
}
const beta: RepoProject = {
  ...alpha, id: 'beta', name: 'Beta', dirName: 'beta', relativePath: 'apps/beta', description: 'Product documentation',
  stack: ['Vue'], tags: ['personal'], git: { branch: 'main' }, scripts: { build: 'vue-tsc && vite build' },
  dependencies: [{ name: 'react', version: '^18.0.0', kind: 'devDependencies' }, { name: '@acme/ui', version: '^2.3.0', kind: 'dependencies' }],
}
const plain: RepoProject = { ...beta, id: 'plain', name: 'Plain', relativePath: 'plain', hasPackageJson: false, scripts: {}, dependencies: [] }
const projects = [alpha, beta, plain]

function search(query = '', selection: SearchSelection = {}, overrides: Partial<Parameters<typeof searchSuggestions>[0]> = {}) {
  return searchSuggestions({ projects, favorites: [], settings: defaultSettings, filterGroups: projectFilterGroups(projects), query, selection, packagesOnly: false, ...overrides })
}
const commands = (rows: SearchSuggestion[]) => rows.filter(row => row.intent.kind === 'command')
const projectIds = (rows: SearchSuggestion[]) => rows.flatMap(row => row.intent.kind === 'project' ? [row.intent.projectId] : [])

describe('smart project search suggestions', () => {
  it('opens with discoverable projects, actions, workspace commands, and useful filters', () => {
    const manyProjects = Array.from({ length: 20 }, (_, index) => ({ ...alpha, id: `p${index}`, name: `Project ${index}` }))
    const rows = search('', {}, { projects: manyProjects, favorites: ['p17'] })
    expect(projectIds(rows)).toHaveLength(5)
    expect(projectIds(rows)[0]).toBe('p17')
    expect(commands(rows)).toEqual([])
    expect(rows.some(row => row.intent.kind === 'template' && row.intent.templateId === 'folder')).toBe(true)
    expect(rows.some(row => row.intent.kind === 'template' && row.intent.templateId === 'scripts')).toBe(true)
    expect(rows.some(row => row.intent.kind === 'workspace' && row.intent.name === 'settings')).toBe(true)
    expect(rows.filter(row => row.intent.kind === 'filter').length).toBeLessThanOrEqual(8)
  })

  it('supports project-first browsing of eligible actions and exact discovered scripts', () => {
    const rows = search('', { projectId: 'alpha' })
    expect(rows.every(row => row.intent.kind === 'command' && row.intent.projectId === 'alpha')).toBe(true)
    expect(rows.find(row => row.title === 'Open project folder')?.intent).toMatchObject({
      kind: 'command', command: { helper: true, intent: { kind: 'action', name: 'open', body: { app: 'folder' } } },
    })
    expect(rows.find(row => row.title === 'Run refresh-data')?.intent).toMatchObject({
      command: { intent: { name: 'run-script', body: { name: 'refresh-data', command: 'node scripts/refresh.js' } } },
    })
    expect(rows.some(row => row.title === 'Run prebuild' || row.title === 'Run empty')).toBe(false)
    expect(rows.some(row => row.title === 'Stop development server')).toBe(false)
    expect(search('', { projectId: 'missing' })).toEqual([])
  })

  it('supports action-first project selection with an immediately dispatchable command', () => {
    const folders = search('', { templateId: 'folder' })
    expect(folders.map(row => row.title)).toEqual(['Alpha', 'Beta', 'Plain'])
    expect(folders[0].intent).toMatchObject({ kind: 'command', projectId: 'alpha', command: { id: 'folder' } })
    expect(search('', { templateId: 'audit' }).map(row => row.title)).toEqual(['Alpha', 'Beta'])
    expect(search('beta', { templateId: 'audit' }).map(row => row.title)).toEqual(['Beta'])
    expect(search('', { templateId: 'react-doctor' }).map(row => row.title)).toEqual(['Alpha', 'Beta'])
  })

  it('lists named scripts across projects after selecting Run a script', () => {
    const rows = search('build', { templateId: 'scripts' })
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.title === 'Run build' && row.group === 'Scripts')).toBe(true)
    expect(rows.map(row => row.description)).toEqual(expect.arrayContaining([
      expect.stringContaining('Alpha · apps/alpha · npm run build · vite build'),
      expect.stringContaining('Beta · apps/beta · npm run build · vue-tsc && vite build'),
    ]))
    expect(search('arbitrary-shell-command', { templateId: 'scripts' })).toEqual([])
  })

  it('combines action and project terms in either order without flooding bare name searches', () => {
    for (const query of ['alpha finder', 'finder alpha', 'open the alpha project dir in finder']) {
      expect(commands(search(query)).map(row => row.intent)).toEqual([
        expect.objectContaining({ projectId: 'alpha', command: expect.objectContaining({ id: 'folder' }) }),
      ])
    }
    expect(projectIds(search('alpha'))).toEqual(['alpha'])
    expect(commands(search('alpha'))).toHaveLength(0)
    expect(commands(search('alpha rerun vulnerability check')).some(row => row.intent.kind === 'command' && row.intent.command.id === 'audit')).toBe(true)
    expect(commands(search('add tag for alpha')).some(row => row.intent.kind === 'command' && row.intent.command.id === 'tags')).toBe(true)
    expect(commands(search('watch alpha')).some(row => row.title === 'Run test:watch')).toBe(true)
  })

  it('uses workspace metadata even when the current result filters hide the project', () => {
    const filteredGroups = projectFilterGroups(projects, { stars: ['starred'], stack: ['Vue'] })
    for (const query of ['customer', 'client work', 'apps/alpha', 'feature/search', 'TypeScript', '@acme/ui']) {
      expect(projectIds(search(query, {}, { favorites: ['beta'], filterGroups: filteredGroups }))).toContain('alpha')
    }
    expect(commands(search('client finder')).some(row => row.intent.kind === 'command' && row.intent.projectId === 'alpha')).toBe(true)
  })

  it('autocompletes filters and workspace operations without executing them', () => {
    const tag = search('client work').find(row => row.intent.kind === 'filter')
    expect(tag?.intent).toEqual({ kind: 'filter', key: 'tags', value: 'tag:client work' })
    expect(search('uncommitted').find(row => row.intent.kind === 'filter')?.intent).toEqual({ kind: 'filter', key: 'git', value: 'dirty' })
    expect(search('daily summary').find(row => row.intent.kind === 'workspace')?.intent).toEqual({ kind: 'workspace', name: 'summary' })
  })

  it('completes package names and declared ranges with deduplicated project counts', () => {
    const rows = search('@acme/ui', {}, { packagesOnly: true })
    expect(rows.map(row => row.title)).toEqual(['@acme/ui', '@acme/ui@^2.3.0'])
    expect(rows.every(row => row.intent.kind === 'package')).toBe(true)
    expect(rows[1].description).toContain('2 projects')
    expect(rows[1].intent).toEqual({ kind: 'package', query: '@acme/ui@^2.3.0' })
    expect(search('internal', {}, { packagesOnly: true }).map(row => row.title)).toEqual(['internal'])
  })

  it('preserves semver overlap and scoped package syntax while completing partially typed versions', () => {
    expect(search('react@19.2.0', {}, { packagesOnly: true }).map(row => row.title)).toEqual(['react@^19.0.0'])
    expect(projectIds(search('react@19.2.0'))).toEqual(['alpha'])
    expect(search('@acme/ui@2.*.*', {}, { packagesOnly: true }).map(row => row.title)).toEqual(['@acme/ui@^2.3.0'])
    expect(search('react@^', {}, { packagesOnly: true }).map(row => row.title)).toEqual(['react@^19.0.0', 'react@^18.0.0'])
    expect(search('react@20', {}, { packagesOnly: true })).toEqual([])
    expect(projectIds(search('react@20'))).toEqual([])
  })

  it('retains all scoped results for pagination and never manufactures missing scripts', () => {
    const manyProjects = Array.from({ length: 70 }, (_, index) => ({ ...alpha, id: `p${index}`, name: `Project ${index}` }))
    expect(search('', { templateId: 'folder' }, { projects: manyProjects })).toHaveLength(70)
    expect(search('npm run destroy alpha')).toEqual([])
    expect(search('', { projectId: 'plain' }).some(row => row.group === 'Scripts')).toBe(false)
  })

  it('reuses an index across queries and scopes, and rebuilds displayed script commands from new metadata', () => {
    const options = { projects, favorites: [], settings: defaultSettings, filterGroups: projectFilterGroups(projects) }
    const index = createProjectSearchIndex(options)
    const query = { query: 'run build', selection: { projectId: 'alpha' }, packagesOnly: false }
    expect(index.search(query)[0].intent).toMatchObject({ command: { intent: { body: { command: 'vite build' } } } })
    expect(index.search({ ...query, query: 'beta finder', selection: {} })[0].intent).toMatchObject({ kind: 'command', projectId: 'beta', command: { id: 'folder' } })
    expect(index.search(query)[0].intent).toMatchObject({ command: { intent: { body: { command: 'vite build' } } } })
    const changed = { ...alpha, scripts: { ...alpha.scripts, build: 'vite build --mode staging' } }
    const refreshed = createProjectSearchIndex({ ...options, projects: [changed, beta], favorites: ['alpha'] })
    expect(refreshed.search(query)[0].intent).toMatchObject({ command: { intent: { body: { command: 'vite build --mode staging' } } } })
    expect(refreshed.search({ ...query, query: 'favorite' })[0].title).toBe('Remove favorite')
  })

  it('keeps the strongest result first and presents each group in one contiguous section', () => {
    const rows = search('run build')
    expect(rows[0].title).toBe('Run build')
    expect(rows[0].group).toBe('Scripts')
    const headings = rows.filter((row, index) => !index || rows[index - 1].group !== row.group).map(row => row.group)
    expect(new Set(headings).size).toBe(headings.length)
    expect(headings).toContain('Actions')
    expect(rows.filter(row => row.group === 'Scripts').map(row => row.title)).toEqual(['Run build', 'Run build'])
  })
})
