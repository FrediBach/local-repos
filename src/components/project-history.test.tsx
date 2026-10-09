// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectHistory } from './project-history'
import { projectHistory } from '../lib/api'
import type { GitHistory, RepoProject } from '../types'

vi.mock('../lib/api', () => ({ projectHistory: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-08T12:00:00Z' }
const props = { project, helper: true, demo: false }
const report: GitHistory = {
  available: true, branches: [{ ref: 'refs/heads/main', name: 'main', remote: false }, { ref: 'refs/heads/feature', name: 'feature', remote: false }],
  authors: [{ name: 'Alice', email: 'alice@example.com' }, { name: 'Bob', email: 'bob@example.com' }],
  commits: [{ hash: '1234567890abcdef', author: 'Alice', email: 'alice@example.com', message: 'Build something useful', committedAt: '2026-10-07T12:00:00Z' }],
  total: 1, offset: 0, hasMore: false, activity: [{ date: '2026-10-07', count: 3 }], from: '2025-10-09', to: '2026-10-08', shallow: false,
}

describe('project commit history', () => {
  it('loads the heatmap and log, combines author and branch filters, and clears them', async () => {
    vi.mocked(projectHistory).mockResolvedValue(report)
    const user = userEvent.setup()
    const onActivity = vi.fn()
    render(<ProjectHistory {...props} onActivity={onActivity} />)
    expect(screen.getByRole('status').textContent).toContain('Loading commit history')
    expect(await screen.findByText('Build something useful')).toBeTruthy()
    expect(onActivity).toHaveBeenCalledExactlyOnceWith('fixture', report)
    expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: '', author: '', offset: 0 })
    expect(screen.getByRole('group', { name: /3 commits in the last 365 days/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /3 commits on October 7, 2026/ })).toBeTruthy()
    expect(screen.getByText('1234567').getAttribute('title')).toBe('1234567890abcdef')
    await user.selectOptions(screen.getByLabelText('Branch'), 'refs/heads/feature')
    await waitFor(() => expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: 'refs/heads/feature', author: '', offset: 0 }))
    await user.selectOptions(screen.getByLabelText('Author'), 'alice@example.com')
    await waitFor(() => expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: 'refs/heads/feature', author: 'alice@example.com', offset: 0 }))
    expect(onActivity).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: '', author: '', offset: 0 }))
  })

  it('pages the log and resets pagination when a filter changes', async () => {
    const commits = Array.from({ length: 25 }, (_, i) => ({ ...report.commits[0], hash: `hash${i}`, message: `Change ${i}` }))
    vi.mocked(projectHistory).mockResolvedValue({ ...report, commits, total: 26, hasMore: true })
    const user = userEvent.setup()
    render(<ProjectHistory {...props} />)
    await screen.findByText('Change 0')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true)
    vi.mocked(projectHistory).mockResolvedValue({ ...report, offset: 25, total: 26 })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('26–26 of 26')).toBeTruthy()
    expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: '', author: '', offset: 25 })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true)
    await user.selectOptions(screen.getByLabelText('Author'), 'bob@example.com')
    await waitFor(() => expect(projectHistory).toHaveBeenLastCalledWith('fixture', { branch: '', author: 'bob@example.com', offset: 0 }))
  })

  it('ignores responses from older filter requests', async () => {
    vi.mocked(projectHistory).mockResolvedValueOnce(report)
    const user = userEvent.setup()
    render(<ProjectHistory {...props} />)
    await screen.findByText('Build something useful')
    let resolveOld!: (report: GitHistory) => void
    vi.mocked(projectHistory).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    await user.selectOptions(screen.getByLabelText('Author'), 'alice@example.com')
    expect(screen.queryByRole('list', { name: 'Commit log' })).toBeNull()
    vi.mocked(projectHistory).mockResolvedValueOnce({ ...report, commits: [{ ...report.commits[0], author: 'Bob', message: 'Newest filter result' }] })
    await user.selectOptions(screen.getByLabelText('Author'), 'bob@example.com')
    await screen.findByText('Newest filter result')
    await act(async () => resolveOld(report))
    expect(screen.queryByText('Build something useful')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Commit log' })).getByText('Bob')).toBeTruthy()
  })

  it('offers recovery after an error and distinguishes empty history from no repository', async () => {
    vi.mocked(projectHistory).mockRejectedValueOnce(new Error('The local helper is unavailable.'))
    const user = userEvent.setup()
    render(<ProjectHistory {...props} />)
    expect((await screen.findByRole('alert')).textContent).toContain('The local helper is unavailable.')
    vi.mocked(projectHistory).mockResolvedValueOnce({ ...report, total: 0, commits: [], activity: [], shallow: true })
    await user.click(screen.getByRole('button', { name: 'Retry commit history' }))
    expect(await screen.findByText('No commits yet.')).toBeTruthy()
    expect(screen.getByText(/This is a shallow clone/)).toBeTruthy()
    vi.mocked(projectHistory).mockResolvedValueOnce({ ...report, available: false })
    await user.click(screen.getByRole('button', { name: 'Refresh commit history' }))
    expect(await screen.findByText('This project is not a Git repository.')).toBeTruthy()
  })

  it('does not contact the helper for browser or demo projects', () => {
    const { rerender } = render(<ProjectHistory {...props} helper={false} />)
    expect(screen.getByText(/Connect with the local helper to browse commit history/)).toBeTruthy()
    rerender(<ProjectHistory {...props} demo />)
    expect(screen.getByText(/Connect a directory with the local helper to explore commit history/)).toBeTruthy()
    expect(projectHistory).not.toHaveBeenCalled()
  })
})
