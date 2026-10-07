// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProjectPreview } from './project-preview'
import type { PreviewKind, RepoProject } from '../types'

afterEach(cleanup)
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: new Date().toISOString(), screenshot: 'data:image/png;base64,preview' }

describe('project preview assets', () => {
  it.each<[PreviewKind, string]>([
    ['og-image', 'Open Graph image'],
    ['logo', 'Logo'],
    ['favicon', 'Favicon'],
  ])('identifies a cached %s as an asset instead of a screenshot', (kind, label) => {
    render(<ProjectPreview project={{ ...project, preview: { kind, source: 'repository', assetPath: 'public/brand.png', capturedAt: project.scannedAt } }} />)
    const image = screen.getByRole('img', { name: `${label} for Fixture` })
    expect(image.getAttribute('src')).toBe(project.screenshot)
    expect(image.parentElement?.classList.contains('asset-preview')).toBe(true)
    expect(image.parentElement?.classList.contains(`asset-preview-${kind}`)).toBe(true)
  })

  it('keeps screenshot presentation for previously cached previews without a kind', () => {
    render(<ProjectPreview project={{ ...project, preview: { source: 'github', url: 'https://example.com/', capturedAt: project.scannedAt } }} />)
    const image = screen.getByRole('img', { name: 'Screenshot of Fixture' })
    expect(image.parentElement?.classList.contains('asset-preview')).toBe(false)
  })

  it('replaces a broken asset with a placeholder and shows a newly captured asset', () => {
    const assetProject: RepoProject = { ...project, preview: { kind: 'favicon', source: 'repository', assetPath: 'public/favicon.png', capturedAt: project.scannedAt } }
    const { rerender } = render(<ProjectPreview project={assetProject} large />)
    fireEvent.error(screen.getByRole('img', { name: 'Favicon for Fixture' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No preview captured')).toBeTruthy()
    rerender(<ProjectPreview project={{ ...assetProject, screenshot: 'data:image/png;base64,replacement' }} large />)
    const image = screen.getByRole('img', { name: 'Favicon for Fixture' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,replacement')
    expect(image.parentElement?.classList.contains('large')).toBe(true)
  })
})
