// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectUnused } from './project-unused'
import type { PackageUnused, RepoProject } from '../types'

afterEach(cleanup)
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-08T12:00:00Z' }
const report: PackageUnused = { scannedAt: '2026-10-08T12:00:00Z', knipVersion: '6.40.0', findings: [{ name: 'unused-dev', version: '^1.0.0', kind: 'devDependencies', line: 8 }] }
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('unused package details', () => {
  it('starts only on request and distinguishes unscanned from a successful empty result', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectUnused {...props} onAction={onAction} />)
    expect(screen.getByText('Unused packages not scanned yet.')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Scan for unused packages' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('unused')
    rerender(<ProjectUnused {...props} project={{ ...project, unused: { ...report, findings: [] } }} />)
    expect(screen.getByRole('status').textContent).toContain('No unused packages reported')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows declared versions, types, manifest locations, scan notes and a dated result during rescans', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const scanned = { ...project, unused: { ...report, warning: 'Review custom entry points' } }
    const { rerender } = render(<ProjectUnused {...props} project={scanned} onAction={onAction} />)
    const status = screen.getByRole('status', { name: 'Unused package scan result' })
    expect(status.textContent).toContain('1 potentially unused package')
    expect(status.textContent).toContain(new Date(report.scannedAt).toLocaleString())
    expect(status.textContent).toContain('Knip 6.40.0')
    const table = screen.getByRole('table')
    for (const text of ['unused-dev', '^1.0.0', 'Dev dependency', 'package.json:8']) expect(within(table).getByText(text)).toBeTruthy()
    expect(screen.getByText('Review custom entry points')).toBeTruthy()
    expect(screen.getByText(/Review findings before removing packages/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan unused again' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('unused')
    rerender(<ProjectUnused {...props} project={scanned} busy="fixture:unused" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scanning unused packages…' }).disabled).toBe(true)
    expect(screen.getByText('unused-dev')).toBeTruthy()
  })

  it('disables actions for demo, non-package projects, or competing work and offers helper connection', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectUnused {...props} demo onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan for unused packages' }))
    expect(onAction).not.toHaveBeenCalled()
    rerender(<ProjectUnused {...props} project={{ ...project, hasPackageJson: false }} onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    expect(screen.getByText(/This project has no package.json/)).toBeTruthy()
    rerender(<ProjectUnused {...props} busy="other:audit" onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    rerender(<ProjectUnused {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText(/Connect with the local helper/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Scan for unused packages' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('unused')
  })
})
