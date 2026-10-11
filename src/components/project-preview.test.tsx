// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProjectPreview } from './project-preview'
import type { PreviewKind, RepoProject } from '../types'
import { previewCommitActivity } from '@/lib/commit-activity'

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

describe('preview commit activity', () => {
  const activity = previewCommitActivity({ from: '2026-09-10', to: '2026-10-08', cachedAt: '2026-10-08T12:00:00Z', shallow: false, activity: [{ date: '2026-10-07', count: 2 }, { date: '2026-10-08', count: 8 }] }, 'ada@example.com', '2026-10-09')

  it('overlays daily bars on a screenshot and retains them after image failure', () => {
    render(<ProjectPreview project={project} activity={activity} />)
    const graph = screen.getByRole('img', { name: /Commit activity: 10 cached commits/ })
    expect(graph.getAttribute('aria-label')).toContain('ada@example.com · partial coverage')
    expect(graph.getAttribute('aria-label')).toContain('last 90 days (UTC)')
    expect(graph.parentElement).toBe(screen.getByRole('img', { name: 'Screenshot of Fixture' }).parentElement)
    const bars = graph.querySelectorAll('path')
    expect(bars).toHaveLength(63)
    expect(screen.getByText('2026-10-07: 2 cached commits')).toBeTruthy()
    expect(screen.getByText('2026-10-08: 8 cached commits')).toBeTruthy()
    expect(screen.queryByText('2026-09-10: 0 cached commits')).toBeNull()
    expect(bars[0].classList.contains('is-unknown')).toBe(true)
    expect(bars[62].classList.contains('is-unknown')).toBe(true)
    expect(bars[62].textContent).toContain('No cached activity')
    fireEvent.error(screen.getByRole('img', { name: 'Screenshot of Fixture' }))
    expect(screen.getByText('No preview captured')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Commit activity: 10 cached commits/ })).toBeTruthy()
  })

  it('labels shallow coverage and shows an empty chart only for known zero counts', () => {
    const { rerender } = render(<ProjectPreview project={project} large activity={{ ...activity, shallow: true, days: activity.days.map(day => ({ ...day, count: 0 })) }} />)
    const graph = screen.getByRole('img', { name: /Commit activity: 0 cached commits/ })
    expect(graph.getAttribute('aria-label')).toContain('Shallow repository')
    expect(graph.querySelectorAll('path')).toHaveLength(0)
    rerender(<ProjectPreview project={project} large />)
    expect(screen.queryByRole('img', { name: /Commit activity:/ })).toBeNull()
    expect(screen.getByRole('img', { name: 'Screenshot of Fixture' })).toBeTruthy()
  })
})
