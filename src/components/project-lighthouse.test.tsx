// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LighthouseReport, RepoProject } from '@/types'
import { ProjectLighthouse } from './project-lighthouse'
import { ProjectLighthouseBadge } from './project-lighthouse-badge'
import { ProjectTabs } from './project-tabs'
import { WorkspaceToolbar } from './workspace-toolbar'

afterEach(cleanup)

const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: ['Vue'], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '2026-10-09T12:00:00Z' }
const report: LighthouseReport = {
  scannedAt: '2026-10-09T12:00:00Z', version: '13.0.0', requestedUrl: 'https://example.com', url: 'https://example.com/app', formFactor: 'mobile', warnings: [],
  categories: [{ id: 'performance', title: 'Performance', score: 82 }, { id: 'accessibility', title: 'Accessibility', score: 100 }, { id: 'best-practices', title: 'Best practices', score: 95 }, { id: 'seo', title: 'SEO', score: 91 }],
  audits: [
    { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', description: 'Largest visible content. [Learn more](https://web.dev/articles/lcp).', score: .85, displayValue: '2.6 s', numericValue: 2600, numericUnit: 'millisecond', scoreDisplayMode: 'numeric', categories: ['performance'] },
    { id: 'image-alt', title: 'Images need alternative text', description: 'Describe each `img` element.', score: 0, scoreDisplayMode: 'binary', categories: ['accessibility'], details: { headings: [{ key: 'node', label: 'Element' }], items: [{ node: '<img src="hero.png">' }], omitted: 2 } },
    { id: 'document-title', title: 'Document has a title', description: 'A title identifies the page.', score: 1, scoreDisplayMode: 'binary', categories: ['accessibility', 'seo'] },
    { id: 'focus-order', title: 'Logical focus order', description: 'Review keyboard navigation.', score: null, scoreDisplayMode: 'manual', categories: ['accessibility'] },
    { id: 'diagnostics', title: 'Diagnostics', description: 'Additional page information.', score: null, scoreDisplayMode: 'informative', categories: ['performance'] },
    { id: 'video-caption', title: 'Video captions', description: 'There are no videos.', score: null, scoreDisplayMode: 'notApplicable', categories: ['accessibility'] },
    { id: 'robots-txt', title: 'Robots file', description: 'Inspect robots.txt.', score: null, scoreDisplayMode: 'error', explanation: 'The request timed out.', categories: ['seo'] },
  ],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('Lighthouse analysis', () => {
  it('keeps unscanned projects unknown and starts only on request', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    render(<ProjectLighthouse {...props} onAction={onAction} />)
    expect(screen.getByText(/No Lighthouse scan yet/)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run Lighthouse' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('lighthouse')
  })

  it('shows four independent scores, tested URL, measurements, audit guidance and affected resources', async () => {
    const user = userEvent.setup()
    render(<ProjectLighthouse {...props} project={{ ...project, lighthouse: report }} />)
    const result = screen.getByRole('status', { name: 'Lighthouse scan result' })
    expect(within(result).getByLabelText('Performance: 82 out of 100')).toBeTruthy()
    expect(within(result).getByLabelText('Accessibility: 100 out of 100')).toBeTruthy()
    expect(within(result).getByLabelText('Best practices: 95 out of 100')).toBeTruthy()
    expect(within(result).getByLabelText('SEO: 91 out of 100')).toBeTruthy()
    expect(screen.getByText('Mobile page audit')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://example.com/app' }).getAttribute('href')).toBe(report.url)
    expect(screen.getByText('Lighthouse 13.0.0')).toBeTruthy()
    expect(screen.getByText(new Date(report.scannedAt).toLocaleString())).toBeTruthy()
    const metrics = screen.getByRole('region', { name: 'Performance measurements' })
    expect(within(metrics).getByText('2.6 s').classList.contains('react-doctor-level-warning')).toBe(true)
    await user.click(screen.getByText('Images need alternative text'))
    expect(screen.getByText('Images need alternative text').closest('details')?.open).toBe(true)
    expect(screen.getByRole('columnheader', { name: 'Element' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '<img src="hero.png">' })).toBeTruthy()
    expect(screen.getByText('2 additional rows omitted from the saved report.')).toBeTruthy()
    expect(screen.getByText('img', { selector: 'code' })).toBeTruthy()
    await user.click(screen.getByText('Largest Contentful Paint', { selector: '.react-doctor-finding-message' }))
    expect(screen.getByRole('link', { name: 'Learn more' }).getAttribute('href')).toBe('https://web.dev/articles/lcp')
  })

  it('separates improvements, passed, manual, informational, inapplicable, and unavailable audits', async () => {
    const user = userEvent.setup()
    render(<ProjectLighthouse {...props} project={{ ...project, lighthouse: report }} />)
    expect(screen.getByRole('button', { name: 'Needs improvement 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Passed 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manual checks 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Informative 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not applicable 1' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Unavailable 1' }))
    expect(screen.getByText('1 of 7 audits shown.')).toBeTruthy()
    expect(screen.getByText('Robots file')).toBeTruthy()
    expect(screen.queryByText('Document has a title')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Needs improvement 2' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Audit category' }), 'accessibility')
    expect(screen.getByText('1 of 7 audits shown.')).toBeTruthy()
    expect(screen.getByText('Images need alternative text')).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Search Lighthouse audits' }), 'nonexistent')
    expect(screen.getByText('No matching audits')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show all audits' }))
    expect(screen.getByText('Logical focus order')).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
  })

  it('does not present missing categories or incomplete audits as clean results', () => {
    render(<ProjectLighthouse {...props} project={{ ...project, lighthouse: { ...report, categories: [], audits: [], warnings: ['Page load was incomplete.'] } }} />)
    expect(screen.getAllByRole('img', { name: /score unavailable/ })).toHaveLength(4)
    expect(screen.getByRole('note', { name: 'Lighthouse scan notes' }).textContent).toContain('Page load was incomplete.')
    expect(screen.getByText('No audit details returned')).toBeTruthy()
    expect(screen.queryByText('No issues reported')).toBeNull()
  })

  it('retains saved analysis while scanning and when frontend eligibility changes', () => {
    const { rerender } = render(<ProjectLighthouse {...props} busy="fixture:lighthouse" project={{ ...project, lighthouse: report }} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scanning frontend…' }).disabled).toBe(true)
    expect(screen.getByText(/Your previous results remain below/)).toBeTruthy()
    expect(screen.getByLabelText('Performance: 82 out of 100')).toBeTruthy()
    rerender(<ProjectLighthouse {...props} project={{ ...project, scripts: { start: 'node api.js' }, lighthouse: report }} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scan frontend again' }).disabled).toBe(true)
    expect(screen.getByLabelText('Performance: 82 out of 100')).toBeTruthy()
  })

  it('gates demo, backend-only and busy projects while allowing browser projects to request connection', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectLighthouse {...props} demo onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run Lighthouse' }).disabled).toBe(true)
    rerender(<ProjectLighthouse {...props} project={{ ...project, scripts: { start: 'node api.js' } }} onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run Lighthouse' }).disabled).toBe(true)
    rerender(<ProjectLighthouse {...props} busy="other:audit" onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run Lighthouse' }).disabled).toBe(true)
    rerender(<ProjectLighthouse {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to scan your frontend with Lighthouse.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Run Lighthouse' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('lighthouse')
  })

  it('renders audit Markdown without active HTML, images or unsafe URLs', () => {
    const unsafe = { ...report.audits[0], description: '<script>alert(1)</script> <img src=x onerror=alert(1)> [Unsafe](javascript:alert%281%29) ![Tracking](https://example.com/pixel)' }
    const { container } = render(<ProjectLighthouse {...props} project={{ ...project, lighthouse: { ...report, url: 'javascript:alert(1)', audits: [unsafe] } }} />)
    expect(container.querySelector('script, img, [onerror]')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull()
  })
})

describe('Lighthouse badge and tab', () => {
  it('shows only saved reports with an explicit performance score and opens their analysis', async () => {
    const user = userEvent.setup(), onClick = vi.fn()
    const { container, rerender } = render(<ProjectLighthouseBadge project={project} onClick={onClick} />)
    expect(container.innerHTML).toBe('')
    rerender(<ProjectLighthouseBadge project={{ ...project, lighthouse: report }} onClick={onClick} />)
    const badge = screen.getByRole('button', { name: 'Fixture: Lighthouse performance score 82 out of 100. View Lighthouse analysis' })
    expect(badge.textContent).toBe('Perf 82')
    expect(badge.title).toContain(new Date(report.scannedAt).toLocaleString())
    await user.click(badge)
    expect(onClick).toHaveBeenCalledOnce()
    rerender(<ProjectLighthouseBadge project={{ ...project, scripts: {}, lighthouse: { ...report, categories: [], warnings: ['Incomplete'] } }} onClick={onClick} />)
    expect(screen.getByRole('button').textContent).toBe('Perf —')
    expect(screen.getByRole('button').classList.contains('react-doctor-level-unknown')).toBe(true)
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('score unavailable, scan notes available')
  })

  it('preserves zero performance scores and uses the Lighthouse thresholds', () => {
    const { rerender } = render(<ProjectLighthouseBadge project={{ ...project, lighthouse: { ...report, categories: [{ id: 'performance', title: 'Performance', score: 0 }] } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toBe('Perf 0')
    expect(screen.getByRole('button').classList.contains('react-doctor-level-poor')).toBe(true)
    rerender(<ProjectLighthouseBadge project={{ ...project, lighthouse: { ...report, categories: [{ id: 'performance', title: 'Performance', score: 90 }] } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').classList.contains('react-doctor-level-good')).toBe(true)
  })

  it('offers a keyboard-accessible Lighthouse tab for frontend projects', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { rerender } = render(<ProjectTabs value="unused" onChange={onChange}><p>Details</p></ProjectTabs>)
    expect(screen.queryByRole('tab', { name: 'Lighthouse' })).toBeNull()
    rerender(<ProjectTabs value="unused" onChange={onChange} frontend><p>Details</p></ProjectTabs>)
    screen.getByRole('tab', { name: 'Unused' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('lighthouse')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Lighthouse' }))
    rerender(<ProjectTabs value="lighthouse" onChange={onChange} frontend><p>Details</p></ProjectTabs>)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Lighthouse' }).id)
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('readme')
  })
})

describe('Lighthouse workspace control', () => {
  const toolbarProps = { projectCount: 2, busy: '', onResync: vi.fn(), scanAllOutdated: vi.fn(), scanAllVulnerabilities: vi.fn(), scanAllReactDoctor: vi.fn(), scanAllLighthouse: vi.fn(), captureAllPreviews: vi.fn() }
  const backend = { ...project, id: 'api', scripts: { start: 'node api.js' } }
  const workspace = { rootName: 'Projects', syncedAt: report.scannedAt, mode: 'helper' as const, projects: [project, backend] }

  it('counts eligible frontends across the workspace and runs through the global callback', async () => {
    const user = userEvent.setup(), onScan = vi.fn()
    render(<WorkspaceToolbar {...toolbarProps} workspace={workspace} scanAllLighthouse={onScan} />)
    const button = screen.getByRole('button', { name: 'Scan frontends with Lighthouse' })
    expect(button.title).toContain('all 1 frontend project, including those hidden by filters')
    await user.click(button)
    expect(onScan).toHaveBeenCalledOnce()
  })

  it('disables absent, ineligible and busy workspaces while explaining browser access', () => {
    const { rerender } = render(<WorkspaceToolbar {...toolbarProps} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scan frontends with Lighthouse' }).disabled).toBe(true)
    rerender(<WorkspaceToolbar {...toolbarProps} workspace={{ ...workspace, projects: [backend] }} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scan frontends with Lighthouse' }).disabled).toBe(true)
    rerender(<WorkspaceToolbar {...toolbarProps} workspace={workspace} busy="batch-lighthouse" />)
    expect(screen.getByRole('button', { name: 'Scan frontends with Lighthouse' }).getAttribute('aria-busy')).toBe('true')
    rerender(<WorkspaceToolbar {...toolbarProps} workspace={{ ...workspace, mode: 'browser' }} />)
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Scan frontends with Lighthouse' })
    expect(button.disabled).toBe(false)
    expect(button.title).toBe('Connect the local helper to run Lighthouse')
  })
})
