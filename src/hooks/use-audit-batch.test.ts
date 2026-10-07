// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { RepoProject } from '../types'
import { useAuditBatch } from './use-audit-batch'

afterEach(cleanup)

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(),
  description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('workspace vulnerability scan queue', () => {
  it('audits every project sequentially and counts only completed scans', async () => {
    const pending = projects.map(() => deferred<{ vulnerable: boolean }>())
    const audit = vi.fn((project: RepoProject) => pending[projects.indexOf(project)].promise)
    const { result } = renderHook(useAuditBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, audit) })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(result.current.progress).toMatchObject({ total: 3, completed: 0, succeeded: 0, vulnerable: 0, current: { id: 'alpha' } })
    await act(async () => { pending[0].resolve({ vulnerable: true }); await pending[0].promise })
    expect(audit).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toMatchObject({ completed: 1, succeeded: 1, vulnerable: 1, current: { id: 'bravo' } })
    await act(async () => { pending[1].resolve({ vulnerable: false }); await pending[1].promise })
    expect(audit).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ completed: 2, succeeded: 2, vulnerable: 1, current: { id: 'charlie' } })
    await act(async () => { pending[2].resolve({ vulnerable: true }); await job })
    expect(result.current.progress).toMatchObject({ status: 'completed', completed: 3, succeeded: 3, vulnerable: 2, current: undefined, failures: [] })
    expect(result.current.isActive()).toBe(false)
  })

  it('continues after unsupported projects fail and preserves their explanations', async () => {
    const audit = vi.fn()
      .mockRejectedValueOnce(new Error('No package.json found.'))
      .mockRejectedValueOnce(new Error('A lockfile is required.'))
      .mockResolvedValueOnce({ vulnerable: true })
    const { result } = renderHook(useAuditBatch)
    await act(async () => { await result.current.run(projects, audit) })
    expect(audit.mock.calls.map(([project]) => project.id)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(result.current.progress).toMatchObject({
      status: 'completed', completed: 3, succeeded: 1, vulnerable: 1,
      failures: [{ id: 'alpha', name: 'Alpha', message: 'No package.json found.' }, { id: 'bravo', name: 'Bravo', message: 'A lockfile is required.' }],
    })
  })

  it('rejects duplicate starts synchronously and lets the current audit finish before stopping', async () => {
    const pending = deferred<{ vulnerable: boolean }>()
    const audit = vi.fn(() => pending.promise)
    const { result } = renderHook(useAuditBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => {
      job = result.current.run(projects, audit)
      expect(result.current.isActive()).toBe(true)
      void result.current.run(projects, audit)
      result.current.dismiss()
    })
    expect(audit).toHaveBeenCalledOnce()
    expect(result.current.progress?.status).toBe('running')
    act(() => { result.current.stop() })
    expect(result.current.progress?.status).toBe('stopping')
    expect(result.current.isActive()).toBe(true)
    await act(async () => { pending.resolve({ vulnerable: true }); await job })
    expect(audit).toHaveBeenCalledOnce()
    expect(result.current.progress).toMatchObject({ status: 'stopped', completed: 1, succeeded: 1, vulnerable: 1, total: 3, current: undefined })
    expect(result.current.isActive()).toBe(false)
    act(() => { result.current.dismiss() })
    expect(result.current.progress).toBeUndefined()
    await act(async () => { await result.current.run([projects[1]], audit) })
    expect(result.current.progress).toMatchObject({ status: 'completed', total: 1, completed: 1 })
  })

  it('invalidates the active callback on unmount and starts no more audits', async () => {
    const pending = deferred<void>()
    let isCurrent!: () => boolean
    const audit = vi.fn((_project: RepoProject, current: () => boolean) => { isCurrent = current; return pending.promise })
    const { result, unmount } = renderHook(useAuditBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, audit) })
    expect(isCurrent()).toBe(true)
    unmount()
    expect(isCurrent()).toBe(false)
    await act(async () => { pending.resolve(); await job })
    expect(audit).toHaveBeenCalledOnce()
    expect(result.current.isActive()).toBe(false)
  })

  it('keeps cache warnings across audit failures and clears them when a later save succeeds', async () => {
    const pending = deferred<void>()
    const audit = vi.fn()
      .mockResolvedValueOnce({ cacheWarning: true, vulnerable: true })
      .mockRejectedValueOnce(new Error('Registry unavailable.'))
      .mockReturnValueOnce(pending.promise)
    const { result } = renderHook(useAuditBatch)
    let job!: ReturnType<typeof result.current.run>
    await act(async () => { job = result.current.run(projects, audit) })
    expect(audit).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ cacheWarnings: 1, completed: 2, succeeded: 1 })
    await act(async () => { pending.resolve(); await job })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 0, succeeded: 2, vulnerable: 1 })
  })

  it('does not create a job for an empty workspace', async () => {
    const audit = vi.fn()
    const { result } = renderHook(useAuditBatch)
    await act(async () => { await result.current.run([], audit) })
    expect(audit).not.toHaveBeenCalled()
    expect(result.current.progress).toBeUndefined()
    expect(result.current.isActive()).toBe(false)
  })
})
