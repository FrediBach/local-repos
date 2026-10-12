// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ProjectCodeMetrics } from './project-code-metrics'
import type { CodeMetrics } from '@/types'

afterEach(cleanup)
const report: CodeMetrics = { scannedAt: '2026-10-12T10:00:00Z', totalLines: 100, totalFiles: 3, languages: [{ name: 'TypeScript', lines: 75, files: 2 }, { name: 'CSS', lines: 25, files: 1 }], partial: false, warnings: [] }

it('shows totals and readable values alongside the visual bars', () => {
  render(<ProjectCodeMetrics report={report} demo={false} />)
  expect(screen.getByText('100')).toBeTruthy()
  expect(screen.getByText(/3 source files/)).toBeTruthy()
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[0]).getByText('TypeScript')).toBeTruthy()
  expect(within(rows[0]).getByText('75')).toBeTruthy()
  expect(within(rows[0]).getByText('75.0%')).toBeTruthy()
  expect(within(rows[1]).getByText('25')).toBeTruthy()
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
