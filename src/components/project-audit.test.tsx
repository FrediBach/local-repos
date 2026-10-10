// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PackageAudit, RepoProject } from '../types'
import { ProjectAudit } from './project-audit'

afterEach(cleanup)
const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z',
}
const cleanReport: PackageAudit = {
  manager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z', counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, findings: [],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('package audit status', () => {
  it.each([true, false, undefined])('describes the shared lockfile only for declared workspace members (%s)', declaredWorkspace => {
    const monorepo = { id: 'studio', name: 'Studio', relativePath: 'studio', packagePath: 'frontend', declaredWorkspace }
    render(<ProjectAudit {...props} project={{ ...project, monorepo }} />)
    if (declaredWorkspace === false) {
      expect(screen.getByText(/Runs pnpm audit against the lockfile/)).toBeTruthy()
      expect(screen.queryByText(/shared workspace lockfile/)).toBeNull()
    } else {
      expect(screen.getByText(/shared workspace lockfile/)).toBeTruthy()
    }
  })

  it('places suppressed findings last with neutral styling, provenance and honest all-suppressed status', () => {
    const suppressed = { name: 'ignored', severity: 'critical' as const, title: 'Accepted issue', suppression: { source: '.trivyignore', ids: ['CVE-2026-12345'], reason: 'Not reachable' } }
    const active = { name: 'active', severity: 'low' as const, title: 'Active issue' }
    const audit = { ...cleanReport, counts: { ...cleanReport.counts, low: 1 }, findings: [suppressed, active], warnings: ['Alias lookup unavailable'] }
    const { rerender } = render(<ProjectAudit {...props} project={{ ...project, audit }} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Active issue')
    expect(rows[1].className).toBe('audit-finding-suppressed')
    expect(within(rows[1]).getByText('Suppressed · critical').className).toContain('audit-color-neutral')
    expect(rows[1].textContent).toContain('.trivyignore')
    expect(rows[1].textContent).toContain('CVE-2026-12345')
    expect(rows[1].textContent).toContain('Not reachable')
    expect(screen.getByText('Alias lookup unavailable')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('1 reported vulnerability')
    rerender(<ProjectAudit {...props} project={{ ...project, audit: { ...cleanReport, findings: [suppressed] } }} />)
    expect(screen.getByRole('status').textContent).toContain('No active vulnerabilities reported')
    expect(screen.getByText(/1 suppressed finding/)).toBeTruthy()
  })

  it('keeps focus on the same advisory when findings for one package are reordered', () => {
    const findings: PackageAudit['findings'] = [
      { name: 'shared-package', severity: 'high', title: 'First advisory', url: 'https://example.com/first' },
      { name: 'shared-package', severity: 'high', title: 'Second advisory', url: 'https://example.com/second' },
    ]
    const audit = { ...cleanReport, findings }
    const { rerender } = render(<ProjectAudit {...props} project={{ ...project, audit }} />)
    const firstLink = screen.getAllByRole('link', { name: /Advisory/ })[0]
    firstLink.focus()
    rerender(<ProjectAudit {...props} project={{ ...project, audit: { ...audit, findings: [...findings].reverse() } }} />)
    expect(document.activeElement).toBe(firstLink)
    expect(firstLink.getAttribute('href')).toBe('https://example.com/first')
    expect(screen.getAllByRole('link', { name: /Advisory/ })[1]).toBe(firstLink)
  })

  it('does not imply an unscanned project is clean and starts scanning only on request', async () => {
    const onAction = vi.fn()
    const user = userEvent.setup()
    render(<ProjectAudit {...props} onAction={onAction} />)
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
    render(<ProjectAudit {...props} project={{ ...project, audit: cleanReport }} onAction={onAction} />)
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
    render(<ProjectAudit {...props} project={{ ...project, audit }} />)
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
    const { rerender } = render(<ProjectAudit {...props} busy="fixture:audit" onAction={onAction} />)
    expect((screen.getByRole('button', { name: 'Scanning…' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ProjectAudit {...props} demo onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan for vulnerabilities' }))
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.getByText('Connect a directory to audit your packages.')).toBeTruthy()
    rerender(<ProjectAudit {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to run package audits.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan for vulnerabilities' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('audit')
  })
})
