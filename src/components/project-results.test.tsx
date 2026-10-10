// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ProjectResults } from './project-results'
import type { RepoProject } from '@/types'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const standalone: RepoProject = { id: 'solo', name: 'Solo', dirName: 'solo', relativePath: 'solo', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' }
const root: RepoProject = { ...standalone, id: 'suite', name: 'Suite', dirName: 'suite', relativePath: 'suite', workspacePackageCount: 2 }
const web: RepoProject = { ...standalone, id: 'web', name: 'Frontend', dirName: 'frontend', relativePath: 'suite/frontend', monorepo: { id: root.id, name: root.name, relativePath: root.relativePath, packagePath: 'frontend' } }
const api: RepoProject = { ...web, id: 'api', name: 'API', dirName: 'api', relativePath: 'suite/api', monorepo: { ...web.monorepo!, packagePath: 'api' } }
const props = { projects: [web, standalone, root, api], favoriteIds: new Set(['web']), filter: 'all' as const, hasRefinements: false, emptyWorkspace: false, isDemo: false, query: '', tagsReady: true, busy: '', onReset: vi.fn(), onConnect: vi.fn(), onOpen: vi.fn(), onEditTags: vi.fn(), onToggleFavorite: vi.fn(), onTagFilter: vi.fn(), onTechnologyFilter: vi.fn(), onAction: vi.fn() }

describe('monorepo results in list view', () => {
  const view = 'list'

  it('renders each project once inside its named monorepo while retaining standalone cards and actions', () => {
    const { container } = render(<ProjectResults {...props} view={view} />)
    const group = screen.getByRole('region', { name: 'Suite monorepo' })
    expect(within(group).getByRole('heading', { name: 'Suite', level: 2 })).toBeTruthy()
    expect(within(group).getByText('3 projects shown')).toBeTruthy()
    expect(within(group).getByText('suite', { selector: 'code' })).toBeTruthy()
    expect(within(group).getAllByRole('article').map(card => card.querySelector('.project-title')?.textContent)).toEqual(['Frontend', 'Suite', 'API'])
    expect(screen.getAllByRole('article').map(card => card.querySelector('.project-title')?.textContent)).toEqual(['Frontend', 'Suite', 'API', 'Solo'])
    expect(group.querySelector(`.monorepo-group-projects.projects-${view}`)).toBeTruthy()
    expect(container.querySelector(`.project-results.projects-${view} > .project-card .project-title`)?.textContent).toBe('Solo')
    expect(within(group).getByText('frontend', { selector: '.project-package-path' })).toBeTruthy()
    expect(within(group).getByText('Monorepo root')).toBeTruthy()
    expect(container.querySelector('.is-subpackage')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Frontend', exact: true }))
    expect(props.onOpen).toHaveBeenCalledWith(web)
    fireEvent.click(within(group).getByRole('button', { name: 'Unfavorite Frontend' }))
    expect(props.onToggleFavorite).toHaveBeenCalledWith(web.id)
  })

  it('shows only matching projects and updates group counts when filters change', () => {
    const { rerender } = render(<ProjectResults {...props} view={view} />)
    rerender(<ProjectResults {...props} view={view} projects={[web]} hasRefinements />)
    const group = screen.getByRole('region', { name: 'Suite monorepo' })
    expect(within(group).getByText('1 project shown')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Suite', exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: 'API', exact: true })).toBeNull()
    rerender(<ProjectResults {...props} view={view} projects={[standalone]} hasRefinements />)
    expect(screen.queryByRole('region', { name: 'Suite monorepo' })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('retains the outer monorepo label when a nested parent is filtered out', () => {
    const nested: RepoProject = { ...api, id: 'nested', name: 'Nested frontend', relativePath: 'suite/frontend/nested', monorepo: { id: web.id, name: web.name, relativePath: web.relativePath, packagePath: 'nested' } }
    render(<ProjectResults {...props} view={view} projects={[nested]} allProjects={[root, web, nested]} hasRefinements />)
    const group = screen.getByRole('region', { name: 'Suite monorepo' })
    expect(within(group).getByText('1 project shown')).toBeTruthy()
    expect(within(group).getAllByRole('article')).toHaveLength(1)
    expect(within(group).getByRole('button', { name: 'Nested frontend', exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Frontend', exact: true })).toBeNull()
  })
})

describe('monorepo results in grid view', () => {
  it('renders cards in sorted order without group boxes and identifies subpackages by directory', () => {
    const { container } = render(<ProjectResults {...props} view="grid" />)
    const cards = screen.getAllByRole('article')
    expect(cards.map(card => card.querySelector('.project-title')?.textContent)).toEqual(['suite/frontend', 'Solo', 'Suite', 'suite/api'])
    expect(container.querySelectorAll('.project-results.projects-grid > .project-card')).toHaveLength(4)
    expect(container.querySelector('.monorepo-group')).toBeNull()
    expect(cards.map(card => card.classList.contains('is-subpackage'))).toEqual([true, false, false, true])

    fireEvent.click(screen.getByRole('button', { name: 'suite/frontend', exact: true }))
    expect(props.onOpen).toHaveBeenLastCalledWith(web)
    fireEvent.click(screen.getByRole('button', { name: 'View suite/api', exact: true }))
    expect(props.onOpen).toHaveBeenLastCalledWith(api)
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorite suite/frontend', exact: true }))
    expect(props.onToggleFavorite).toHaveBeenCalledWith(web.id)
  })

  it('shows only matching cards when filters change', () => {
    const { rerender } = render(<ProjectResults {...props} view="grid" />)
    rerender(<ProjectResults {...props} view="grid" projects={[web]} allProjects={props.projects} hasRefinements />)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'suite/frontend', exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Suite', exact: true })).toBeNull()
    rerender(<ProjectResults {...props} view="grid" projects={[standalone]} allProjects={props.projects} hasRefinements />)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Solo', exact: true })).toBeTruthy()
  })

  it('uses a filtered parent directory when the scanned root has a scoped package name', () => {
    const scannedRoot: RepoProject = { ...root, name: '@company/toolkit', dirName: 'toolkit', relativePath: '.' }
    const member: RepoProject = { ...web, name: '@company/web', relativePath: 'apps/web', monorepo: { id: scannedRoot.id, name: scannedRoot.name, relativePath: '.', packagePath: 'apps/web' } }
    render(<ProjectResults {...props} view="grid" projects={[member]} allProjects={[scannedRoot, member]} hasRefinements />)
    expect(screen.getByRole('button', { name: 'toolkit/apps/web', exact: true })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('uses the parent path when its project is unavailable and marks independent subpackages', () => {
    const member: RepoProject = { ...web, monorepo: { ...web.monorepo!, name: '@company/suite', relativePath: 'clients/suite', packagePath: 'packages/frontend', declaredWorkspace: false } }
    render(<ProjectResults {...props} view="grid" projects={[member]} />)
    expect(screen.getByRole('button', { name: 'suite/packages/frontend', exact: true })).toBeTruthy()
    expect(screen.getByRole('article').classList.contains('is-subpackage')).toBe(true)
  })

  it('falls back to the parent name when its directory cannot be recovered', () => {
    const member: RepoProject = { ...web, monorepo: { ...web.monorepo!, relativePath: '.' } }
    render(<ProjectResults {...props} view="grid" projects={[member]} />)
    expect(screen.getByRole('button', { name: 'Suite/frontend', exact: true })).toBeTruthy()
  })
})
