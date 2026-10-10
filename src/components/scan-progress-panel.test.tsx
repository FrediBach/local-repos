// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScanProgressPanel } from './scan-progress-panel'
import { ReactDoctorBatchProgress } from './react-doctor-batch-progress'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('live scan steps', () => {
  it('shows the reported step and elapsed time without announcing every clock tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T09:00:00Z'))
    const now = Date.now()
    const progress = { title: 'Running React Doctor', projectName: 'My app', stage: { phase: 'Checking React code', detail: 'Lint and dead-code analysis are running.' }, startedAt: now - 65_000, stageStartedAt: now - 10_000 }
    const { rerender } = render(<ScanProgressPanel progress={progress} />)
    expect(screen.getByText('Checking React code')).toBeTruthy()
    expect(screen.getByText('Lint and dead-code analysis are running.')).toBeTruthy()
    expect(screen.getByText('1m 05s elapsed')).toBeTruthy()
    expect(screen.getByText('10s in this step')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('12s in this step')).toBeTruthy()
    for (const timer of screen.getAllByRole('timer')) expect(timer.getAttribute('aria-live')).toBe('off')
    expect(screen.getByRole('status').textContent).not.toContain('12s')
    rerender(<ScanProgressPanel progress={{ ...progress, stage: { phase: 'Calculating score' }, stageStartedAt: Date.now() }} />)
    expect(screen.getByText('Calculating score')).toBeTruthy()
    expect(screen.getByText('0s in this step')).toBeTruthy()
    expect(screen.queryByText('Checking React code')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('keeps the project count honest while showing an active step through stop-after-current', () => {
    const progress = { status: 'stopping' as const, total: 45, completed: 3, succeeded: 3, withFindings: 3, findings: 123, scoreTotal: 178, scored: 3, limited: 0, failures: [], cacheWarnings: 0, current: { id: 'fourth', name: 'bolo3d' }, stage: { phase: 'Checking React code' } }
    const { rerender } = render(<ReactDoctorBatchProgress progress={progress} onStop={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Checking React code')).toBeTruthy()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('45')
    expect(bar.getAttribute('aria-valuetext')).toContain('Checking React code')
    expect(screen.getByText('The current project will finish before the queue stops.')).toBeTruthy()
    rerender(<ReactDoctorBatchProgress progress={{ ...progress, status: 'stopped', current: undefined }} onStop={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByText('Checking React code')).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
  })
})
