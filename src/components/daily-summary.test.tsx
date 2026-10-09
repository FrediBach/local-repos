// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DailySummary } from './daily-summary'
import { projectDay } from '../lib/api'
import { dayRange, localDate } from '../lib/daily-summary'
import type { GitDay, RepoProject } from '../types'

vi.mock('../lib/api', () => ({ projectDay: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks() })
const root: RepoProject = { id: 'root', name: 'Notebook', dirName: 'notebook', relativePath: 'notebook', stack: [], scripts: {}, description: '', packageManager: 'npm', scannedAt: '' }
const other = { ...root, id: 'other', name: 'Website', relativePath: 'website' }
const member = { ...root, id: 'member', monorepo: { id: root.id, name: root.name, relativePath: root.relativePath, packagePath: 'web' } }
const report: GitDay = { available: true, shallow: false, commits: [
  { hash: '1234567890', author: 'Alice', email: 'alice@example.com', message: 'Add notebooks', committedAt: '2026-10-08T09:00:00Z', branches: [{ ref: 'refs/heads/feature', name: 'feature', remote: false }] },
  { hash: 'abcdef1234', author: 'Bob', email: 'bob@example.com', message: 'Fix navigation', committedAt: '2026-10-08T11:00:00Z', branches: [{ ref: 'refs/heads/main', name: 'main', remote: false }] },
] }
const props = { projects: [root, member, other], helper: true, onConnect: vi.fn() }

describe('daily summary', () => {
  it('loads every repository once, orders the timeline, combines filters and copies the filtered report', async () => {
    const user = userEvent.setup()
    vi.mocked(projectDay).mockImplementation(async id => id === root.id ? report : { ...report, commits: [{ ...report.commits[0], hash: '9876543210', message: 'Website update', committedAt: '2026-10-08T08:00:00Z' }] })
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<DailySummary {...props} />)
    expect(screen.getByRole('button', { name: 'Copy summary' }).hasAttribute('disabled')).toBe(true)
    const timeline = await screen.findByRole('region', { name: 'Commit timeline' })
    expect(projectDay).toHaveBeenCalledTimes(2)
    expect(projectDay).toHaveBeenCalledWith('root', dayRange(localDate()))
    expect(within(timeline).getAllByRole('listitem').map(item => item.textContent)).toEqual([expect.stringContaining('Website update'), expect.stringContaining('Add notebooks'), expect.stringContaining('Fix navigation')])
    await user.selectOptions(screen.getByLabelText('Author'), 'alice@example.com')
    await user.selectOptions(screen.getByLabelText('Project'), 'root')
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(1)
    expect(within(timeline).queryByText('Fix navigation')).toBeNull()
    expect(projectDay).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    const text = clipboard.mock.calls[0][0]
    expect(text).toContain('Author: alice@example.com')
    expect(text).toContain('Project: Notebook')
    expect(text).toContain('Add notebooks')
    expect(text).not.toContain('Website update')
    expect(await screen.findByText('Summary copied for your report or bookings.')).toBeTruthy()
  })

  it('ignores stale responses after a date change and disables export until the new day is complete', async () => {
    let resolveOld!: (result: GitDay) => void
    vi.mocked(projectDay).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce({ ...report, commits: [] })
    render(<DailySummary {...props} projects={[root]} />)
    fireEvent.change(screen.getByLabelText('Work day'), { target: { value: '2026-10-07' } })
    expect(await screen.findByText('No commits to show for this day.')).toBeTruthy()
    await act(async () => resolveOld(report))
    expect(screen.queryByRole('region', { name: 'Commit timeline' })).toBeNull()
    expect(projectDay).toHaveBeenLastCalledWith('root', dayRange('2026-10-07'))
  })

  it('retains successful projects, reports failures and shallow history in exports, and retries', async () => {
    const user = userEvent.setup()
    vi.mocked(projectDay).mockImplementation(async id => {
      if (id === other.id) throw new Error('Git unavailable')
      return { ...report, shallow: true }
    })
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<DailySummary {...props} />)
    expect(await screen.findByText('Summary incomplete · 1 project could not be read')).toBeTruthy()
    expect(screen.getByText('Notebook: shallow clone; only downloaded history is available.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    expect(clipboard.mock.calls[0][0]).toContain('Website: Git unavailable')
    vi.mocked(projectDay).mockResolvedValue({ ...report, commits: [] })
    await user.click(screen.getByRole('button', { name: 'Retry summary' }))
    await screen.findByText('No commits to show for this day.')
    expect(screen.queryByText(/Summary incomplete/)).toBeNull()
  })

  it('offers selectable text when clipboard access fails', async () => {
    const user = userEvent.setup()
    vi.mocked(projectDay).mockResolvedValue(report)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'))
    render(<DailySummary {...props} projects={[root]} />)
    await screen.findByRole('region', { name: 'Commit timeline' })
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    const text = await screen.findByRole('textbox', { name: 'Daily summary report' }) as HTMLTextAreaElement
    expect(text.value).toContain('Add notebooks')
    expect(text.readOnly).toBe(true)
  })

  it.each(['resolve', 'reject'] as const)('ignores a clipboard %s after the summary filters change', async outcome => {
    const user = userEvent.setup()
    vi.mocked(projectDay).mockResolvedValue(report)
    let resolve!: () => void
    let reject!: (error: Error) => void
    vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no }))
    render(<DailySummary {...props} projects={[root]} />)
    await screen.findByRole('region', { name: 'Commit timeline' })
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    await user.selectOptions(screen.getByLabelText('Author'), 'alice@example.com')
    await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('Denied')) })
    expect(screen.queryByText('Summary copied for your report or bookings.')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Daily summary report' })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Author'), '')
    expect(screen.queryByText('Summary copied for your report or bookings.')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Daily summary report' })).toBeNull()
  })

  it('keeps the latest copy feedback when an older request finishes later', async () => {
    const user = userEvent.setup()
    vi.mocked(projectDay).mockResolvedValue(report)
    let rejectOld!: (error: Error) => void
    vi.spyOn(navigator.clipboard, 'writeText')
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectOld = reject }))
      .mockResolvedValueOnce()
    render(<DailySummary {...props} projects={[root]} />)
    await screen.findByRole('region', { name: 'Commit timeline' })
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    await user.click(screen.getByRole('button', { name: 'Copy summary' }))
    expect(await screen.findByText('Summary copied for your report or bookings.')).toBeTruthy()
    await act(async () => { rejectOld(new Error('Denied')) })
    expect(screen.getByText('Summary copied for your report or bookings.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Daily summary report' })).toBeNull()
  })

  it('has honest disconnected, empty, invalid-date and complete-failure states', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DailySummary {...props} helper={false} />)
    expect(projectDay).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Connect directory' }))
    expect(props.onConnect).toHaveBeenCalledOnce()
    vi.mocked(projectDay).mockRejectedValue(new Error('Helper offline'))
    rerender(<DailySummary {...props} projects={[root]} />)
    expect(await screen.findByText('The summary could not be loaded.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy summary' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Work day'), { target: { value: '' } })
    expect(screen.getByRole('alert').textContent).toContain('Choose a valid work day')
    expect(projectDay).toHaveBeenCalledOnce()
    vi.mocked(projectDay).mockResolvedValue({ ...report, commits: [] })
    await user.click(screen.getByRole('button', { name: 'Today', exact: true }))
    await waitFor(() => expect(screen.queryByText('No commits to show for this day.')).toBeTruthy())
  })
})
