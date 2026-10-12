// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectCodeMetrics } from './project-code-metrics'
import { CodeDistributionChart } from './code-distribution-chart'
import type { CodeMetrics } from '@/types'

afterEach(cleanup)
const report: CodeMetrics = { scannedAt: '2026-10-12T10:00:00Z', totalLines: 100, totalFiles: 3, languages: [{ name: 'TypeScript', lines: 75, files: 2 }, { name: 'CSS', lines: 25, files: 1 }], partial: false, warnings: [] }

it('renders 100 visible-width bars with sparse labels and exact counts available in the table', async () => {
  const user = userEvent.setup()
  const buckets = Array.from({ length: 100 }, (_, index) => ({ minLines: index * 10, maxLines: index * 10 + 9, files: index + 1 }))
  render(<CodeDistributionChart buckets={buckets} type="all file types" partial={false} />)
  const chart = screen.getByRole('img')
  const bars = [...chart.querySelectorAll('rect')]
  expect(bars).toHaveLength(100)
  expect(bars.every(bar => Number(bar.getAttribute('width')) >= 5)).toBe(true)
  expect(chart.querySelectorAll('text').length).toBeLessThanOrEqual(20)
  await user.click(screen.getByText('View file counts by range'))
  const table = within(screen.getByRole('table'))
  expect(table.getAllByRole('row')).toHaveLength(101)
  expect(table.getByRole('row', { name: '990–999 100' })).toBeTruthy()
})

it('shows totals and readable values alongside the visual bars', () => {
  render(<ProjectCodeMetrics report={report} demo={false} />)
  expect(screen.getAllByText('100')).toHaveLength(2)
  expect(screen.getByText(/3 source files/)).toBeTruthy()
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[0]).getByText('TypeScript')).toBeTruthy()
  expect(within(rows[0]).getByText('75')).toBeTruthy()
  expect(within(rows[0]).getByText('75.0%')).toBeTruthy()
  expect(within(rows[1]).getByText('25')).toBeTruthy()
})

function statistic(label: string) {
  const panel = within(screen.getByRole('region', { name: 'File statistics' }))
  return panel.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
}

it('switches file counts and line statistics between the overall report and a selected type', async () => {
  const user = userEvent.setup()
  const detailed: CodeMetrics = {
    ...report,
    fileStatistics: { average: 100 / 3, min: 15, max: 60, median: 25 },
    languages: [
      { name: 'TypeScript', lines: 75, files: 2, fileStatistics: { average: 37.5, min: 15, max: 60, median: 37.5 } },
      { name: 'CSS', lines: 25, files: 1, fileStatistics: { average: 25, min: 25, max: 25, median: 25 } },
    ],
  }
  const { rerender } = render(<ProjectCodeMetrics report={detailed} demo={false} />)
  expect(statistic('Files')).toBe('3')
  expect(statistic('Average')).toBe((100 / 3).toLocaleString(undefined, { maximumFractionDigits: 1 }))
  expect(statistic('Median')).toBe('25')
  await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), 'TypeScript')
  expect(statistic('Files')).toBe('2')
  expect(statistic('Lines')).toBe('75')
  expect(statistic('Minimum')).toBe('15')
  expect(statistic('Maximum')).toBe('60')
  expect(statistic('Median')).toBe((37.5).toLocaleString())
  await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), '')
  expect(statistic('Files')).toBe('3')
  await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), 'TypeScript')
  rerender(<ProjectCodeMetrics report={{ ...detailed, languages: [detailed.languages[1]] }} demo={false} />)
  expect((screen.getByRole('combobox', { name: 'File type' }) as HTMLSelectElement).value).toBe('')
  expect(statistic('Files')).toBe('3')
})

it('keeps old cached statistics unavailable, uses dashes for no files, and labels partial statistics', () => {
  const { rerender } = render(<ProjectCodeMetrics report={report} demo={false} />)
  expect(statistic('Files')).toBe('3')
  expect(statistic('Median')).toBe('—')
  expect(screen.getByText('Resync your directory to collect per-file statistics.')).toBeTruthy()
  rerender(<ProjectCodeMetrics report={{ ...report, totalFiles: 0, totalLines: 0, languages: [], fileStatistics: { average: null, min: null, max: null, median: null } }} demo={false} />)
  expect(statistic('Files')).toBe('0')
  expect(statistic('Average')).toBe('—')
  expect(screen.getByText('No source files were counted in this selection.')).toBeTruthy()
  rerender(<ProjectCodeMetrics report={{ ...report, partial: true, fileStatistics: { average: 100 / 3, min: 15, max: 60, median: 25 } }} demo={false} />)
  expect(screen.getByText(/successfully read in this partial scan/)).toBeTruthy()
})

it('distinguishes missing data, partial results, and a completed empty scan', () => {
  const { rerender } = render(<ProjectCodeMetrics demo={false} />)
  expect(screen.getByText('Resync your directory to collect code metrics.')).toBeTruthy()
  expect(screen.queryByText('0')).toBeNull()
  rerender(<ProjectCodeMetrics report={{ ...report, totalLines: 0, totalFiles: 0, languages: [], partial: true, warnings: ['Unreadable folder'] }} demo={false} />)
  expect(screen.getByText('lines counted · partial scan')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Unreadable folder')
  rerender(<ProjectCodeMetrics report={{ ...report, totalLines: 0, totalFiles: 0, languages: [] }} demo={false} />)
  expect(screen.getByText('No nonblank lines found in recognized source files.')).toBeTruthy()
})

it('plots the selected file type and exposes exact range counts in an accessible table', async () => {
  const user = userEvent.setup()
  render(<ProjectCodeMetrics report={{ ...report,
    distribution: [{ minLines: 0, maxLines: 49, files: 2 }, { minLines: 50, maxLines: 99, files: 1 }],
    languages: report.languages.map(row => ({ ...row, distribution: [{ minLines: 0, maxLines: 49, files: 1 }, { minLines: 50, maxLines: 99, files: row.name === 'CSS' ? 0 : 1 }] })),
  }} demo={false} />)
  expect(screen.getByRole('img', { name: /File size distribution for all file types/ })).toBeTruthy()
  await user.click(screen.getByText('View file counts by range'))
  const table = within(screen.getByRole('table', { name: 'File size distribution for all file types' }))
  expect(table.getByRole('row', { name: '0–49 2' })).toBeTruthy()
  expect(table.getByRole('row', { name: '50–99 1' })).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), 'CSS')
  expect(screen.getByRole('img', { name: /File size distribution for CSS/ })).toBeTruthy()
  expect(within(screen.getByRole('table', { name: 'File size distribution for CSS' })).getByRole('row', { name: '50–99 0' })).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), '')
  expect(screen.getByRole('img', { name: /File size distribution for all file types/ })).toBeTruthy()
})

it('distinguishes missing distributions, empty scans and zero-line files, and labels partial graphs', () => {
  const { rerender } = render(<ProjectCodeMetrics report={report} demo={false} />)
  expect(screen.getByText('Resync your directory to collect the file-size distribution.')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
  rerender(<ProjectCodeMetrics report={{ ...report, distribution: [], totalFiles: 0, totalLines: 0, languages: [] }} demo={false} />)
  expect(screen.getByText('No counted files to plot.')).toBeTruthy()
  rerender(<ProjectCodeMetrics report={{ ...report, distribution: [{ minLines: 0, maxLines: 0, files: 1 }], totalFiles: 1, totalLines: 0, languages: [], partial: true }} demo={false} />)
  expect(screen.getByRole('img', { name: /0 lines: 1 file/ })).toBeTruthy()
  expect(screen.getByText('· partial scan')).toBeTruthy()
})
