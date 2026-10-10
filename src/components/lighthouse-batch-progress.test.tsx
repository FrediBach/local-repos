// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LighthouseBatchProgress as Progress } from '../hooks/use-lighthouse-batch'
import { LighthouseBatchProgress } from './lighthouse-batch-progress'

afterEach(cleanup)
const progress: Progress = { status: 'running', total: 3, completed: 1, succeeded: 1, withFindings: 1, findings: 4, scoreTotal: 82, scored: 1, limited: 0, failures: [], cacheWarnings: 0, current: { id: 'bravo', name: 'Bravo' } }

describe('workspace Lighthouse progress', () => {
  it('announces frontend scope and performance-only average, with stop-after-current controls', async () => {
    const user = userEvent.setup(), onStop = vi.fn()
    const { rerender } = render(<LighthouseBatchProgress progress={progress} onStop={onStop} onDismiss={vi.fn()} />)
    const bar = screen.getByRole('progressbar', { name: 'Lighthouse scan progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect(screen.getByText('1 of 3 frontend projects processed')).toBeTruthy()
    expect(screen.getByText('82/100 average performance score')).toBeTruthy()
    expect(screen.getByText('4 audits need attention across 1 project')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    expect(onStop).toHaveBeenCalledOnce()
    rerender(<LighthouseBatchProgress progress={{ ...progress, status: 'stopping' }} onStop={onStop} onDismiss={vi.fn()} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Stopping…' }).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Stopping after Bravo')
  })

  it('explains failures and missing scores without treating them as zero or perfect', async () => {
    const user = userEvent.setup(), onDismiss = vi.fn()
    render(<LighthouseBatchProgress progress={{ ...progress, status: 'completed', completed: 3, succeeded: 2, scoreTotal: 0, scored: 0, limited: 2, current: undefined, cacheWarnings: 1, failures: [{ id: 'charlie', name: 'Charlie', message: 'Scan timed out.' }] }} onStop={vi.fn()} onDismiss={onDismiss} />)
    expect(screen.getByText('No performance scores available')).toBeTruthy()
    expect(screen.queryByText('0/100 average performance score')).toBeNull()
    expect(screen.getByText(/2 projects have limited results/)).toBeTruthy()
    expect(screen.getByText(/1 result could not be saved in browser storage/)).toBeTruthy()
    await user.click(screen.getByText('1 scan failed — view details'))
    expect(screen.getByText('Scan timed out.')).toBeTruthy()
    expect(screen.getByText('Previous Lighthouse results are kept when a scan fails.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dismiss Lighthouse progress' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
