// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuditBatchProgress as Progress } from '../hooks/use-audit-batch'
import { AuditBatchProgress } from './audit-batch-progress'

afterEach(cleanup)

const progress: Progress = { status: 'running', total: 3, completed: 1, succeeded: 1, vulnerable: 1, failures: [], cacheWarnings: 0, current: { id: 'bravo', name: 'Bravo' } }

describe('workspace vulnerability scan progress', () => {
  it('announces completed work and provides a stop control until the active scan finishes', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const onDismiss = vi.fn()
    const { rerender } = render(<AuditBatchProgress progress={progress} onStop={onStop} onDismiss={onDismiss} />)
    expect(screen.getByRole('region', { name: 'Workspace vulnerability scan' })).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Vulnerability scan progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect(bar.getAttribute('aria-valuetext')).toBe('1 of 3 processed; scanning Bravo')
    expect(screen.getByRole('status').textContent).toContain('Scanning vulnerabilities')
    expect(screen.getByText('1 scanned')).toBeTruthy()
    expect(screen.getByText('1 vulnerable')).toBeTruthy()
    expect(screen.getByText(/Package names and versions are sent/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    expect(onStop).toHaveBeenCalledOnce()
    rerender(<AuditBatchProgress progress={{ ...progress, status: 'stopping' }} onStop={onStop} onDismiss={onDismiss} />)
    expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Stopping after Bravo')
    expect(screen.queryByRole('button', { name: 'Dismiss audit progress' })).toBeNull()
  })

  it('explains failed scans and cache warnings without presenting failures as clean results', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<AuditBatchProgress progress={{ ...progress, status: 'completed', completed: 3, succeeded: 2, current: undefined, cacheWarnings: 1, failures: [{ id: 'charlie', name: 'Charlie', message: 'Registry unavailable.' }] }} onStop={vi.fn()} onDismiss={onDismiss} />)
    expect(screen.getByRole('status').textContent).toBe('Vulnerability scan complete')
    expect(screen.getByText('2 scanned')).toBeTruthy()
    expect(screen.getByText('1 vulnerable')).toBeTruthy()
    expect(screen.getByText('1 failed')).toBeTruthy()
    expect(screen.getByText(/1 result could not be saved in browser storage/)).toBeTruthy()
    await user.click(screen.getByText('1 scan failed — view details'))
    expect(screen.getByText('Registry unavailable.')).toBeTruthy()
    expect(screen.getByText('Previous vulnerability results are kept when a scan fails.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dismiss audit progress' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('keeps partial progress visible after the queue stops', () => {
    render(<AuditBatchProgress progress={{ ...progress, status: 'stopped', current: undefined }} onStop={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('Vulnerability scan stopped')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
    expect(screen.queryByRole('button', { name: 'Stop after current' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss audit progress' })).toBeTruthy()
  })
})
