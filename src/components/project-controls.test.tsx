// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectControls } from './project-controls'
import type { PreviewKind, RepoProject } from '../types'

afterEach(cleanup)
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: new Date().toISOString() }

describe('preview controls', () => {
  it('offers project URL capture even without a dev script', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<ProjectControls project={project} helper demo={false} busy="" onAction={action} />)
    expect(screen.queryByRole('button', { name: 'Start server' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Capture from' }), 'website')
    await user.click(screen.getByRole('button', { name: 'Capture preview' }))
    expect(action).toHaveBeenCalledWith('screenshot', { source: 'website' })
  })

  it('allows local image fallback without a development script', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<ProjectControls project={project} helper demo={false} busy="" onAction={action} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Capture from' }), 'local')
    await user.click(screen.getByRole('button', { name: 'Capture preview' }))
    expect(action).toHaveBeenCalledWith('screenshot', { source: 'local' })
  })

  it('allows a start-only project to run and displays the actual captured source', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<ProjectControls project={{ ...project, scripts: { start: 'react-scripts start' }, preview: { source: 'github', url: 'https://example.com/demo/', capturedAt: new Date().toISOString() } }} helper demo={false} busy="" onAction={action} />)
    expect(screen.getByText('react-scripts start')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start server' }))
    expect(action).toHaveBeenCalledWith('start')
    expect(screen.getByRole('link', { name: /Captured from GitHub website/ }).getAttribute('href')).toBe('https://example.com/demo/')
  })

  it.each<[PreviewKind, string]>([
    ['og-image', 'Open Graph image'],
    ['logo', 'Logo'],
    ['favicon', 'Favicon'],
  ])('links %s provenance to its source website', (kind, label) => {
    render(<ProjectControls project={{ ...project, preview: { kind, source: 'github', url: 'https://example.com/demo/', assetUrl: 'https://cdn.example.com/asset.png', capturedAt: project.scannedAt } }} helper demo={false} busy="" onAction={vi.fn()} />)
    expect(screen.getByRole('link', { name: new RegExp(`${label} from GitHub website`) }).getAttribute('href')).toBe('https://example.com/demo/')
    expect(screen.queryByRole('link', { name: /Captured from/ })).toBeNull()
  })

  it('shows a repository asset as a relative file path without linking to a local file', () => {
    render(<ProjectControls project={{ ...project, preview: { kind: 'logo', source: 'repository', assetPath: 'public/logo.svg', capturedAt: project.scannedAt } }} helper demo={false} busy="" onAction={vi.fn()} />)
    expect(screen.getByText('Logo from repository')).toBeTruthy()
    expect(screen.getByText('public/logo.svg')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/If screenshots fail, looks for an Open Graph image/)).toBeTruthy()
  })
})
