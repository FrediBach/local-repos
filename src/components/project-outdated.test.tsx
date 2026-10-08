// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PackageOutdated, RepoProject } from '../types'
import { OUTDATED_SCORE_EXPLANATION } from '../lib/outdated'
import { ProjectOutdated } from './project-outdated'
import { ProjectPackages } from './project-packages'

afterEach(cleanup)

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z',
}
const report: PackageOutdated = {
  manager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z', score: 21.3, level: 'moderate',
  findings: [
    { name: 'major-package', current: '1.2.3', wanted: '1.5.0', latest: '3.0.0', kind: 'dependencies', change: 'major', majorGap: 2, score: 20 },
    { name: 'minor-package', current: '2.0.0', wanted: '2.1.0', latest: '2.1.0', kind: 'devDependencies', change: 'minor', majorGap: 0, score: 1 },
    { name: 'patch-package', current: '3.0.0', latest: '3.0.3', change: 'patch', majorGap: 0, score: 0.3 },
  ],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('outdated package details', () => {
  it('offers separate bounded update actions and disables them during maintenance', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectOutdated {...props} project={{ ...project, outdated: report }} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Update patches' }))
    expect(onAction).toHaveBeenLastCalledWith('update-patches')
    await user.click(screen.getByRole('button', { name: 'Update minor versions' }))
    expect(onAction).toHaveBeenLastCalledWith('update-minor')
    expect(screen.getByText(/Patches stay within the installed minor version/)).toBeTruthy()
    rerender(<ProjectOutdated {...props} project={{ ...project, outdated: report }} busy="fixture:update-minor" onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Update patches' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Update minor versions' }).disabled).toBe(true)
    rerender(<ProjectOutdated {...props} helper={false} project={{ ...project, outdated: report }} />)
    expect(screen.queryByRole('button', { name: 'Update patches' })).toBeNull()
  })

  it('keeps unscanned state explicit and runs only the outdated action when requested', async () => {
    const onAction = vi.fn()
    const user = userEvent.setup()
    render(<ProjectOutdated {...props} onAction={onAction} />)
    expect(screen.getByText('Outdated packages not scanned yet.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/Package names and versions are sent to the configured registry/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Scan for outdated packages' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('outdated')
  })

  it('shows summed score, source timestamp, version differences and scoring explanation', () => {
    render(<ProjectOutdated {...props} project={{ ...project, outdated: report }} />)
    const status = screen.getByRole('status', { name: 'Outdated package scan result' })
    expect(status.textContent).toContain('3 outdated packages')
    expect(status.textContent).toContain('Update score 21.3')
    expect(status.textContent).toContain(new Date(report.scannedAt).toLocaleString())
    expect(status.textContent).toContain('pnpm')
    expect(within(status).getByText('21.3').parentElement?.classList.contains('outdated-level-moderate')).toBe(true)
    expect(screen.getByText(OUTDATED_SCORE_EXPLANATION)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Production dependencies' })).getByText('major-package')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Development dependencies' })).getByText('minor-package')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Other dependencies' })).getByText('patch-package')).toBeTruthy()
    const findings = screen.getAllByRole('listitem')
    expect(findings).toHaveLength(3)
    expect(within(findings[0]).getByText('1.2.3')).toBeTruthy()
    expect(within(findings[0]).getByText('3.0.0')).toBeTruthy()
    expect(within(findings[0]).getByText('2 major versions behind')).toBeTruthy()
    expect(within(findings[0]).getByText('+20 points')).toBeTruthy()
    expect(within(findings[0]).getByText(/Within declared range:/).textContent).toContain('1.5.0')
    expect(within(findings[1]).getByText('Minor update')).toBeTruthy()
    expect(within(findings[1]).getByText('Dev dependency')).toBeTruthy()
    expect(within(findings[1]).getByText('+1 point')).toBeTruthy()
    expect(within(findings[1]).queryByText(/Within declared range:/)).toBeNull()
    expect(within(findings[2]).getByText('Patch update')).toBeTruthy()
    expect(within(findings[2]).getByText('+0.3 points')).toBeTruthy()
  })

  it('retains saved results while rescanning and prevents competing actions', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { rerender } = render(<ProjectOutdated {...props} project={{ ...project, outdated: report }} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan outdated again' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('outdated')
    rerender(<ProjectOutdated {...props} project={{ ...project, outdated: report }} busy="fixture:outdated" onAction={onAction} />)
    expect((screen.getByRole('button', { name: 'Checking packages…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('3 outdated packages')
    expect(screen.getByText('major-package')).toBeTruthy()
    rerender(<ProjectOutdated {...props} project={{ ...project, outdated: report }} busy="other:audit" onAction={onAction} />)
    expect((screen.getByRole('button', { name: 'Scan outdated again' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not describe skipped packages as current and shows why they were skipped', async () => {
    const user = userEvent.setup()
    render(<ProjectOutdated {...props} project={{ ...project, outdated: { ...report, score: 0, level: 'current', findings: [], skipped: [{ name: 'local-package', reason: 'Local workspace dependency' }] } }} />)
    expect(screen.getByRole('status').textContent).toContain('No outdated packages found among checked packages')
    expect(screen.queryByText('All checked packages are up to date')).toBeNull()
    await user.click(screen.getByText('1 package was not compared'))
    expect(screen.getByText('Skipped packages do not contribute to the score.')).toBeTruthy()
    expect(screen.getByText('local-package')).toBeTruthy()
    expect(screen.getByText('Local workspace dependency')).toBeTruthy()
  })

  it('shows a zero score after a scan finds no available updates', () => {
    render(<ProjectOutdated {...props} project={{ ...project, outdated: { ...report, findings: [], score: 0, level: 'current' } }} />)
    expect(screen.getByRole('status').textContent).toContain('All checked packages are up to date')
    expect(screen.getByRole('status').textContent).toContain('Update score 0')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('explains helper requirements and disables scans for demo projects', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { rerender } = render(<ProjectOutdated {...props} demo onAction={onAction} />)
    expect(screen.getByText('Connect a directory to check for outdated packages.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan for outdated packages' }))
    expect(onAction).not.toHaveBeenCalled()
    rerender(<ProjectOutdated {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to check for outdated packages.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan for outdated packages' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('outdated')
  })

  it('keeps outdated and vulnerability rescan actions separate in the packages panel', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ProjectPackages {...props} project={{ ...project, outdated: report, audit: { manager: 'pnpm', scannedAt: report.scannedAt, counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, findings: [] } }} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(onAction).toHaveBeenLastCalledWith('audit')
    await user.click(screen.getByRole('button', { name: 'Scan outdated again' }))
    expect(onAction).toHaveBeenLastCalledWith('outdated')
    expect(within(screen.getByRole('region', { name: 'Package vulnerability audit' })).getByRole('status').textContent).toContain('No known vulnerabilities reported')
    expect(within(screen.getByRole('region', { name: 'Outdated packages' })).getByRole('status').textContent).toContain('3 outdated packages')
  })
})
