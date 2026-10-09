// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactDoctorReport, RepoProject } from '../types'
import { ProjectReactDoctor } from './project-react-doctor'
import { ProjectReactDoctorBadge } from './project-react-doctor-badge'
import { ProjectTabs } from './project-tabs'

afterEach(cleanup)

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-09T12:00:00Z',
}
const report: ReactDoctorReport = {
  scannedAt: '2026-10-09T12:00:00Z', version: '0.9.17', score: 83, label: 'Great', findings: [
    { filePath: 'src/Card.tsx', line: 12, column: 4, plugin: 'react', rule: 'no-array-index-key', severity: 'warning', message: 'Avoid array index keys.', help: 'Use a stable identifier from your data.', category: 'Correctness' },
    { filePath: 'src/List.tsx', line: 20, column: 7, plugin: 'react', rule: 'no-array-index-key', severity: 'warning', message: 'Avoid array index keys.', help: 'Use a stable identifier from your data.', category: 'Correctness' },
    { filePath: 'src/App.tsx', line: 6, column: 0, plugin: 'react', rule: 'no-direct-mutation-state', severity: 'error', message: 'Do not mutate state directly.', help: 'Create a new object when updating state.', category: 'State & Effects' },
    { filePath: 'src/Thumbnail.tsx', line: 0, column: 0, plugin: 'jsx-a11y', rule: 'alt-text', severity: 'warning', message: 'Images need alternative text.', help: 'Describe the image for screen readers.', category: 'Accessibility' },
  ],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('React Doctor report', () => {
  it('keeps unscanned scores unknown and only scans on request', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    render(<ProjectReactDoctor {...props} onAction={onAction} />)
    expect(screen.getByText(/No React Doctor scan yet/)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/Diagnostic details are sent to React Doctor/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run React Doctor' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('react-doctor')
  })

  it('summarizes the score and prioritizes errors while grouping duplicate findings', async () => {
    const user = userEvent.setup()
    render(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: report }} />)
    const status = screen.getByRole('status', { name: 'React Doctor scan result' })
    expect(within(status).getByLabelText('React Doctor score: 83 out of 100')).toBeTruthy()
    expect(status.textContent).toContain('1 error')
    expect(status.textContent).toContain('3 warnings')
    expect(status.textContent).toContain('4 files')
    expect(screen.getByText(new Date(report.scannedAt).toLocaleString())).toBeTruthy()
    expect(screen.getByText('React Doctor 0.9.17')).toBeTruthy()
    const summaries = document.querySelectorAll('.react-doctor-finding > summary')
    expect(summaries).toHaveLength(3)
    expect(summaries[0].textContent).toContain('Do not mutate state directly.')
    expect(screen.getAllByText('Avoid array index keys.')).toHaveLength(1)
    await user.click(screen.getByText('Avoid array index keys.'))
    expect(screen.getByText('Avoid array index keys.').closest('details')?.open).toBe(true)
    expect(screen.getByText('Use a stable identifier from your data.')).toBeTruthy()
    expect(screen.getByText('src/Card.tsx:12:4')).toBeTruthy()
    expect(screen.getByText('src/List.tsx:20:7')).toBeTruthy()
    expect(screen.getByText('react/no-array-index-key')).toBeTruthy()
    expect(screen.getByText('src/App.tsx:6')).toBeTruthy()
    expect(screen.getByText('src/Thumbnail.tsx')).toBeTruthy()
  })

  it('combines severity, category and source file search, and can clear empty results', async () => {
    const user = userEvent.setup()
    render(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: report }} />)
    await user.click(screen.getByRole('button', { name: 'Warnings 3' }))
    expect(screen.queryByText('Do not mutate state directly.')).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Finding category' }), 'Correctness')
    expect(screen.queryByText('Images need alternative text.')).toBeNull()
    await user.type(screen.getByRole('searchbox', { name: 'Search React Doctor findings' }), 'src/list')
    expect(screen.getByText('1 of 4 findings shown.')).toBeTruthy()
    expect(screen.queryByText('src/Card.tsx:12:4')).toBeNull()
    expect(screen.getByText('src/List.tsx:20:7')).toBeTruthy()
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.getByText('No matching findings')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show all findings' }))
    expect(screen.getByText('Do not mutate state directly.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
  })

  it('retains results during scans and blocks competing actions', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: report }} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Scan React again' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('react-doctor')
    rerender(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: report }} busy="fixture:react-doctor" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scanning React code…' }).disabled).toBe(true)
    expect(screen.getByText(/Your previous results remain below/)).toBeTruthy()
    expect(screen.getByRole('status', { name: 'React Doctor scan result' }).textContent).toContain('83')
    rerender(<ProjectReactDoctor {...props} busy="other:audit" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run React Doctor' }).disabled).toBe(true)
  })

  it('distinguishes unavailable and incomplete scans from clean results', () => {
    const warning = 'Lint checks could not complete.'
    const { rerender } = render(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: { ...report, score: null, label: 'Incomplete scan', findings: [], warning } }} />)
    const status = screen.getByRole('status', { name: 'React Doctor scan result' })
    expect(within(status).getByLabelText('Score unavailable')).toBeTruthy()
    expect(status.textContent).not.toContain('100')
    expect(screen.getByRole('note', { name: 'React Doctor scan notes' }).textContent).toContain(warning)
    expect(screen.getByText('No findings returned')).toBeTruthy()
    expect(screen.queryByText('No issues reported')).toBeNull()
    rerender(<ProjectReactDoctor {...props} project={{ ...project, reactDoctor: { ...report, score: 100, label: 'Great', findings: [] } }} />)
    expect(screen.getByText('No issues reported')).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByLabelText('React Doctor score: 100 out of 100')).toBeTruthy()
  })

  it('disables sample and non-React scans but lets browser projects request helper connection', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectReactDoctor {...props} demo onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run React Doctor' }).disabled).toBe(true)
    rerender(<ProjectReactDoctor {...props} project={{ ...project, stack: [] }} onAction={onAction} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run React Doctor' }).disabled).toBe(true)
    rerender(<ProjectReactDoctor {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to scan your React code.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Run React Doctor' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('react-doctor')
  })
})

describe('React Doctor card badge', () => {
  it('hides absent reports and non-React projects', () => {
    const { container, rerender } = render(<ProjectReactDoctorBadge project={project} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    rerender(<ProjectReactDoctorBadge project={{ ...project, stack: [], reactDoctor: report }} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows even a perfect score, provides timestamp and opens the findings', async () => {
    const user = userEvent.setup(), onClick = vi.fn()
    render(<ProjectReactDoctorBadge project={{ ...project, reactDoctor: { ...report, score: 100, findings: [] } }} onClick={onClick} />)
    const badge = screen.getByRole('button', { name: 'Fixture: React Doctor score 100 out of 100. View React Doctor findings' })
    expect(badge.textContent).toBe('100')
    expect(badge.classList.contains('react-doctor-level-good')).toBe(true)
    expect(badge.title).toContain(new Date(report.scannedAt).toLocaleString())
    await user.click(badge)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps missing scores distinct from zero and styles scores by React Doctor thresholds', () => {
    const { rerender } = render(<ProjectReactDoctorBadge project={{ ...project, reactDoctor: { ...report, score: null, warning: 'Score service unavailable.' } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toBe('—')
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Score unavailable, scan notes available')
    expect(screen.getByRole('button').classList.contains('react-doctor-level-unknown')).toBe(true)
    rerender(<ProjectReactDoctorBadge project={{ ...project, reactDoctor: { ...report, score: 0 } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toBe('0')
    expect(screen.getByRole('button').classList.contains('react-doctor-level-poor')).toBe(true)
    rerender(<ProjectReactDoctorBadge project={{ ...project, reactDoctor: { ...report, score: 60 } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').classList.contains('react-doctor-level-warning')).toBe(true)
  })
})

describe('React Doctor project tab', () => {
  it('appears only for React projects and participates in keyboard navigation', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { rerender } = render(<ProjectTabs value="packages" onChange={onChange}><p>Details</p></ProjectTabs>)
    expect(screen.queryByRole('tab', { name: 'React Doctor' })).toBeNull()
    rerender(<ProjectTabs value="packages" onChange={onChange} react><p>Details</p></ProjectTabs>)
    screen.getByRole('tab', { name: 'Packages' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('react-doctor')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'React Doctor' }))
    rerender(<ProjectTabs value="react-doctor" onChange={onChange} react><p>Details</p></ProjectTabs>)
    expect(screen.getByRole('tab', { name: 'React Doctor' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'React Doctor' }).id)
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('readme')
  })
})
