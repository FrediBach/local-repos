// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RepoProject } from '../types'
import { PackageMatches, ProjectPackages } from './project-packages'

afterEach(cleanup)
const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z',
  dependencies: [
    { name: 'react', version: '^19.0.0', kind: 'dependencies' },
    { name: '@types/react', version: '~19.0.0', kind: 'devDependencies' },
    { name: 'react', version: '>=18 <20', kind: 'peerDependencies' },
    { name: 'react-dom', version: 'npm:@custom/react-dom@19', kind: 'optionalDependencies' },
    { name: 'workspace-tools', version: 'workspace:*', kind: 'devDependencies' },
  ],
}

describe('declared package details', () => {
  it('shows declared version specs and all dependency types and filters by package name', async () => {
    const user = userEvent.setup()
    render(<ProjectPackages project={project} />)
    expect(screen.getByText(/Versions are declared ranges from package.json/)).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    for (const dependency of project.dependencies!) expect(within(table).getByText(dependency.version)).toBeTruthy()
    for (const label of ['Dependency', 'Dev dependency', 'Peer dependency', 'Optional dependency']) expect(within(table).getAllByText(label).length).toBeGreaterThan(0)
    const filter = screen.getByRole('textbox', { name: 'Filter packages in project' })
    await user.type(filter, '  @TYPES/REACT  ')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('~19.0.0')).toBeTruthy()
    await user.clear(filter)
    await user.type(filter, '19.0.0')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No packages match this search.')).toBeTruthy()
    await user.clear(filter)
    expect(screen.getAllByRole('row')).toHaveLength(6)
  })

  it('distinguishes old cached metadata from a project with no declared packages', () => {
    const { rerender } = render(<ProjectPackages project={{ ...project, dependencies: undefined }} />)
    expect(screen.getByText('Resync your directory to load package details.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(<ProjectPackages project={{ ...project, dependencies: [] }} />)
    expect(screen.getByText('No declared packages found.')).toBeTruthy()
    expect(screen.queryByText(/Resync your directory/)).toBeNull()
  })

  it('filters the package table by compatible versions, including scoped packages', async () => {
    const user = userEvent.setup()
    render(<ProjectPackages project={project} />)
    const filter = screen.getByRole('textbox', { name: 'Filter packages in project' })
    await user.type(filter, 'react@19.*.*')
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('^19.0.0')).toBeTruthy()
    expect(screen.getByText('>=18 <20')).toBeTruthy()
    expect(screen.queryByText('@types/react')).toBeNull()
    await user.clear(filter)
    await user.type(filter, '@types/react@19.0.5')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText('~19.0.0')).toBeTruthy()
    await user.clear(filter)
    await user.type(filter, 'react@20.*.*')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No packages match this search.')).toBeTruthy()
  })

  it('shows only compatible declarations in card matches', () => {
    render(<PackageMatches project={project} query="react@18.3.1" />)
    const matches = screen.getByLabelText('Matching packages')
    expect(within(matches).getByText('react')).toBeTruthy()
    expect(within(matches).getByText('>=18 <20')).toBeTruthy()
    expect(within(matches).queryByText('^19.0.0')).toBeNull()
  })

  it('limits card matches with a remainder count and hides an empty search', () => {
    const { rerender, container } = render(<PackageMatches project={project} query="react" />)
    expect(screen.getByLabelText('Matching packages')).toBeTruthy()
    expect(screen.getByText('+1 more in Packages')).toBeTruthy()
    expect(screen.getByText('^19.0.0')).toBeTruthy()
    expect(screen.getByTitle('Peer dependency · declared version')).toBeTruthy()
    expect(screen.queryByText('npm:@custom/react-dom@19')).toBeNull()
    rerender(<PackageMatches project={project} query=" " />)
    expect(container.innerHTML).toBe('')
  })
})
