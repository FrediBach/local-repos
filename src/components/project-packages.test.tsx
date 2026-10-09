// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PackageAudit, RepoProject } from '../types'
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
const cleanReport: PackageAudit = {
  manager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z', counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, findings: [],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('declared package details', () => {
  it('shows declared version specs and all dependency types and filters by package name', async () => {
    const user = userEvent.setup()
    render(<ProjectPackages {...props} />)
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
    const { rerender } = render(<ProjectPackages {...props} project={{ ...project, dependencies: undefined }} />)
    expect(screen.getByText('Resync your directory to load package details.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(<ProjectPackages {...props} project={{ ...project, dependencies: [] }} />)
    expect(screen.getByText('No declared packages found.')).toBeTruthy()
    expect(screen.queryByText(/Resync your directory/)).toBeNull()
  })

  it('filters the package table by compatible versions, including scoped packages', async () => {
    const user = userEvent.setup()
    render(<ProjectPackages {...props} />)
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

describe('package audit status', () => {
  it('keeps focus on the same advisory when findings for one package are reordered', () => {
    const findings: PackageAudit['findings'] = [
      { name: 'shared-package', severity: 'high', title: 'First advisory', url: 'https://example.com/first' },
      { name: 'shared-package', severity: 'high', title: 'Second advisory', url: 'https://example.com/second' },
    ]
    const audit = { ...cleanReport, findings }
    const { rerender } = render(<ProjectPackages {...props} project={{ ...project, audit }} />)
    const firstLink = screen.getAllByRole('link', { name: /Advisory/ })[0]
    firstLink.focus()
    rerender(<ProjectPackages {...props} project={{ ...project, audit: { ...audit, findings: [...findings].reverse() } }} />)
    expect(document.activeElement).toBe(firstLink)
    expect(firstLink.getAttribute('href')).toBe('https://example.com/first')
    expect(screen.getAllByRole('link', { name: /Advisory/ })[1]).toBe(firstLink)
  })

  it('does not imply an unscanned project is clean and starts scanning only on request', async () => {
    const onAction = vi.fn()
    const user = userEvent.setup()
    render(<ProjectPackages {...props} onAction={onAction} />)
    expect(screen.getByText('Not scanned yet.')).toBeTruthy()
    expect(screen.queryByText('No known vulnerabilities reported')).toBeNull()
    expect(screen.getByText(/Runs pnpm audit against the lockfile/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Package vulnerability audit' })).getByText(/Package names and versions are sent to the configured registry/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Scan for vulnerabilities' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('audit')
  })

  it('shows a successful clean result, timestamp, package manager, and a rescan action', async () => {
    const onAction = vi.fn()
    const user = userEvent.setup()
    render(<ProjectPackages {...props} project={{ ...project, audit: cleanReport }} onAction={onAction} />)
    expect(screen.getByRole('status').textContent).toContain('No known vulnerabilities reported')
    expect(screen.getByRole('status').textContent).toContain('Last scan')
    expect(screen.getByRole('status').textContent).toContain('pnpm')
    expect(screen.queryByText('Not scanned yet.')).toBeNull()
    expect(screen.getByText(/Saved result from the last successful scan/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('audit')
  })

  it('renders findings with severity, range, directness and fix availability and only safe advisory links', () => {
    const audit: PackageAudit = {
      ...cleanReport,
      counts: { ...cleanReport.counts, high: 2, moderate: 3 },
      findings: [
        { name: 'valid', severity: 'high', title: 'Unsafe redirect', range: '<2.0.0', direct: true, fixAvailable: true, url: 'https://github.com/advisories/GHSA-example' },
        { name: 'javascript', severity: 'high', title: 'Script scheme', direct: false, fixAvailable: false, url: 'javascript:alert(1)' },
        { name: 'data', severity: 'moderate', title: 'Data scheme', url: 'data:text/html,hello' },
        { name: 'file', severity: 'moderate', title: 'File scheme', url: 'file:///etc/passwd' },
        { name: 'relative', severity: 'moderate', title: 'Relative path', url: '/advisory' },
      ],
    }
    render(<ProjectPackages {...props} project={{ ...project, audit }} />)
    expect(screen.getByRole('status').textContent).toContain('5 reported vulnerabilities')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('<2.0.0')).toBeTruthy()
    expect(screen.getByText('Direct dependency')).toBeTruthy()
    expect(screen.getByText('Transitive dependency')).toBeTruthy()
    expect(screen.getByText('Fix available')).toBeTruthy()
    expect(screen.getByText('No fix reported')).toBeTruthy()
    const advisory = screen.getByRole('link', { name: 'Advisory' })
    expect(advisory.getAttribute('href')).toBe('https://github.com/advisories/GHSA-example')
    expect(advisory.getAttribute('target')).toBe('_blank')
    expect(advisory.getAttribute('rel')).toContain('noreferrer')
  })

  it('disables scans during work or in demo mode and explains browser-mode requirements', async () => {
    const onAction = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ProjectPackages {...props} busy="fixture:audit" onAction={onAction} />)
    expect((screen.getByRole('button', { name: 'Scanning…' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ProjectPackages {...props} demo onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan for vulnerabilities' }))
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.getByText('Connect a directory to audit your packages.')).toBeTruthy()
    rerender(<ProjectPackages {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to run package audits.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan for vulnerabilities' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('audit')
  })
})
