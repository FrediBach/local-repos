// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactDoctorBatchProgress as Progress } from '../hooks/use-react-doctor-batch'
import { ReactDoctorBatchProgress } from './react-doctor-batch-progress'

afterEach(cleanup)

const progress: Progress = { status: 'running', total: 3, completed: 1, succeeded: 1, withFindings: 1, findings: 4, scoreTotal: 86, scored: 1, limited: 0, failures: [], cacheWarnings: 0, current: { id: 'bravo', name: 'Bravo' } }

describe('workspace React Doctor scan progress', () => {
  it('announces eligible projects, findings, available scores and stopping progress', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const { rerender } = render(<ReactDoctorBatchProgress progress={progress} onStop={onStop} onDismiss={vi.fn()} />)
    const bar = screen.getByRole('progressbar', { name: 'React Doctor scan progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect(screen.getByText('1 of 3 React projects processed')).toBeTruthy()
    expect(screen.getByText('4 findings across 1 project')).toBeTruthy()
    expect(screen.getByText('86/100 average score')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    expect(onStop).toHaveBeenCalledOnce()
    rerender(<ReactDoctorBatchProgress progress={{ ...progress, status: 'stopping' }} onStop={onStop} onDismiss={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Stopping after Bravo')
  })

  it('explains limited results and failures without reporting a zero health score', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<ReactDoctorBatchProgress progress={{ ...progress, status: 'completed', completed: 3, succeeded: 2, scoreTotal: 0, scored: 0, limited: 2, current: undefined, cacheWarnings: 1, failures: [{ id: 'charlie', name: 'Charlie', message: 'Scan timed out.' }] }} onStop={vi.fn()} onDismiss={onDismiss} />)
    expect(screen.getByText('No scores available')).toBeTruthy()
    expect(screen.queryByText('0/100 average score')).toBeNull()
    expect(screen.getByText(/2 projects have limited results/)).toBeTruthy()
    expect(screen.getByText('1 failed')).toBeTruthy()
    expect(screen.getByText(/1 result could not be saved in browser storage/)).toBeTruthy()
    await user.click(screen.getByText('1 scan failed — view details'))
    expect(screen.getByText('Scan timed out.')).toBeTruthy()
    expect(screen.getByText('Previous React Doctor results are kept when a scan fails.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dismiss React Doctor progress' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
