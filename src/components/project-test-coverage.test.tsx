// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTestCoverage } from './project-test-coverage'
import { ProjectTestCoverageBadge } from './project-test-coverage-badge'
import { ProjectTabs } from './project-tabs'
import type { CoverageMetrics, RepoProject, TestCoverageReport } from '../types'

afterEach(cleanup)

const metrics = (covered: number, total: number): CoverageMetrics => Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map(key => [key, { covered, total, pct: total ? covered / total * 100 : null }])) as unknown as CoverageMetrics
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: { test: 'vitest' }, hasPackageJson: true, packageManager: 'npm', scannedAt: '2026-10-09T12:00:00Z' }
const report: TestCoverageReport = {
  scannedAt: '2026-10-09T12:00:00Z', runner: 'vitest', source: 'run', command: 'vitest run --coverage', metrics: metrics(8, 10), files: [
    { path: 'src/Big.ts', metrics: metrics(80, 100) },
    { path: 'src/Small.ts', metrics: metrics(2, 10) },
    { path: 'src/Covered.ts', metrics: metrics(20, 20) },
  ],
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('coverage report', () => {
  it('runs only on request and describes project test execution', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    render(<ProjectTestCoverage {...props} onAction={onAction} />)
    expect(screen.getByText(/No coverage scan yet/)).toBeTruthy()
    expect(screen.getByText(/Tests can execute project setup and write files/)).toBeTruthy()
    expect(screen.getByText(/First-time setup needs npm and network access/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run coverage scan' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('test-coverage')
  })

  it('shows four measured metrics, command, scope and all file details', () => {
    render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: report }} />)
    const totals = screen.getByRole('group', { name: 'Coverage totals' })
    for (const name of ['Lines', 'Statements', 'Functions', 'Branches']) expect(within(totals).getByLabelText(`${name}: 80%`)).toBeTruthy()
    expect(screen.getByText('Tests run')).toBeTruthy()
    expect(screen.getByText(new Date(report.scannedAt).toLocaleString())).toBeTruthy()
    expect(screen.getByText(report.command!)).toBeTruthy()
    expect(screen.getByText(/Untested files may be excluded/)).toBeTruthy()
    expect(screen.getByText('coverage.include')).toBeTruthy()
    expect(screen.getByText('collectCoverageFrom')).toBeTruthy()
    expect(screen.getByRole('row', { name: 'src/Big.ts 80% 80% 80% 80% 20' })).toBeTruthy()
  })

  it('keeps existing report age distinct from import time and warns about failed tests', () => {
    const imported: TestCoverageReport = { ...report, source: 'existing-report', runner: 'report', reportModifiedAt: '2026-10-01T12:00:00Z', reportPath: 'coverage/lcov.info', command: undefined, warning: 'Statement coverage is unavailable.' }
    const { rerender } = render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: imported }} />)
    expect(screen.getByText('Existing report imported')).toBeTruthy()
    expect(screen.queryByText('Tests run')).toBeNull()
    expect(screen.getByText(new Date(imported.reportModifiedAt!).toLocaleString())).toBeTruthy()
    expect(screen.getByText(/Tests were not run by this scan/)).toBeTruthy()
    expect(screen.getByRole('note', { name: 'Coverage scan notes' }).textContent).toContain(imported.warning)
    rerender(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: { ...report, exitCode: 1 } }} />)
    expect(screen.getByText(/test command exited with code 1/)).toBeTruthy()
  })

  it('identifies a cached provider while keeping a successful run free of warnings', () => {
    render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: { ...report, exitCode: 0, tooling: { packageName: '@vitest/coverage-v8', version: '4.1.11' } } }} />)
    expect(screen.getByRole('note', { name: 'Coverage tooling' }).textContent).toContain('@vitest/coverage-v8@4.1.11 supplied from the Local Repos cache.')
    expect(screen.getByText('Tests run')).toBeTruthy()
    expect(screen.queryByRole('note', { name: 'Coverage scan notes' })).toBeNull()
  })

  it('shows unknown and empty metrics without inventing full or zero coverage', () => {
    render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: { ...report, metrics: { lines: { covered: 0, total: 0, pct: 100 }, statements: null, functions: { covered: 0, total: 5, pct: 0 }, branches: null }, files: [] } }} />)
    const totals = screen.getByRole('group', { name: 'Coverage totals' })
    expect(within(totals).getAllByText('—')).toHaveLength(3)
    expect(within(totals).getByLabelText('Functions: 0%')).toBeTruthy()
    expect(within(totals).queryByText('100%')).toBeNull()
    expect(within(totals).getByText('No measurable items')).toBeTruthy()
    expect(screen.getByText(/This report contains totals only/)).toBeTruthy()
  })

  it('sorts coverage gaps, searches and filters across files', async () => {
    const user = userEvent.setup()
    render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: report }} />)
    const firstFile = () => within(screen.getByRole('table')).getAllByRole('row')[1].textContent
    expect(firstFile()).toContain('src/Big.ts')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort coverage files' }), 'coverage')
    expect(firstFile()).toContain('src/Small.ts')
    await user.selectOptions(screen.getByRole('combobox'), 'path')
    expect(firstFile()).toContain('src/Big.ts')
    await user.click(screen.getByRole('checkbox', { name: 'Only files with coverage gaps' }))
    expect(screen.queryByText('src/Covered.ts')).toBeNull()
    await user.type(screen.getByRole('searchbox', { name: 'Search coverage files' }), 'small')
    expect(screen.getByText('Showing 1 of 1 matching files (3 total).')).toBeTruthy()
    expect(screen.queryByText('src/Big.ts')).toBeNull()
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.getByText('No matching files')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show all files' }))
    expect(screen.getByText('src/Covered.ts')).toBeTruthy()
  })

  it('limits large report rendering while searching all files', async () => {
    const user = userEvent.setup()
    const files = Array.from({ length: 220 }, (_, index) => ({ path: `src/file-${String(index).padStart(3, '0')}.ts`, metrics: metrics(1, 2) }))
    render(<ProjectTestCoverage {...props} project={{ ...project, testCoverage: { ...report, files } }} />)
    expect(screen.getAllByRole('row')).toHaveLength(101)
    expect(screen.getByText('Showing 100 of 220 files.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show 100 more files' }))
    expect(screen.getAllByRole('row')).toHaveLength(201)
    await user.type(screen.getByRole('searchbox'), 'file-219')
    expect(screen.getByText('src/file-219.ts')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('keeps previous results during scans and disables competing or demo actions', () => {
    const { rerender } = render(<ProjectTestCoverage {...props} busy="fixture:test-coverage" project={{ ...project, testCoverage: report }} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scanning coverage…' }).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Your previous results remain below.')
    expect(screen.getByRole('status').textContent).toContain('First-time scans may prepare missing coverage tools.')
    expect(screen.getByRole('group', { name: 'Coverage totals' })).toBeTruthy()
    rerender(<ProjectTestCoverage {...props} busy="other:audit" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run coverage scan' }).disabled).toBe(true)
    rerender(<ProjectTestCoverage {...props} demo />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run coverage scan' }).disabled).toBe(true)
  })

  it('offers individual package imports and lets browser mode request helper connection', async () => {
    const user = userEvent.setup(), onAction = vi.fn()
    const { rerender } = render(<ProjectTestCoverage {...props} project={{ ...project, scripts: {} }} onAction={onAction} />)
    expect(screen.getByText(/importing does not run tests/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Import coverage report' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('test-coverage')
    rerender(<ProjectTestCoverage {...props} helper={false} onAction={onAction} />)
    expect(screen.getByText(/Connect with the local helper/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Run coverage scan' }))
    expect(onAction).toHaveBeenCalledTimes(2)
  })
})

describe('coverage card badge', () => {
  it('hides absent reports and opens saved coverage even after runner removal', async () => {
    const user = userEvent.setup(), onClick = vi.fn()
    const { container, rerender } = render(<ProjectTestCoverageBadge project={project} onClick={onClick} />)
    expect(container.innerHTML).toBe('')
    rerender(<ProjectTestCoverageBadge project={{ ...project, scripts: {}, testCoverage: report }} onClick={onClick} />)
    const badge = screen.getByRole('button', { name: 'Fixture: 80% line coverage. View test coverage' })
    expect(badge.title).toContain('Tests run:')
    await user.click(badge)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('labels imported report age and shows unavailable metrics distinctly from zero', () => {
    const imported = { ...report, source: 'existing-report' as const, metrics: { ...report.metrics, lines: null } }
    const { rerender } = render(<ProjectTestCoverageBadge project={{ ...project, testCoverage: imported }} onClick={vi.fn()} />)
    const badge = screen.getByRole('button')
    expect(badge.textContent).toBe('—')
    expect(badge.getAttribute('aria-label')).toContain('Line coverage unavailable, imported report')
    expect(badge.title).toContain('Report age unknown')
    rerender(<ProjectTestCoverageBadge project={{ ...project, testCoverage: { ...report, metrics: metrics(0, 5) } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toBe('0%')
  })
})

it('makes the coverage tab conditional and keyboard accessible', async () => {
  const user = userEvent.setup(), onChange = vi.fn()
  const { rerender } = render(<ProjectTabs value="packages" onChange={onChange}><p>Details</p></ProjectTabs>)
  expect(screen.queryByRole('tab', { name: 'Coverage' })).toBeNull()
  rerender(<ProjectTabs value="react-doctor" onChange={onChange} react coverage><p>Details</p></ProjectTabs>)
  screen.getByRole('tab', { name: 'React Doctor' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(onChange).toHaveBeenLastCalledWith('coverage')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Coverage' }))
  rerender(<ProjectTabs value="coverage" onChange={onChange} react coverage><p>Details</p></ProjectTabs>)
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Coverage' }).id)
  await user.keyboard('{ArrowRight}')
  expect(onChange).toHaveBeenLastCalledWith('readme')
})
