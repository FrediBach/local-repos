// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { RepoProject } from '../types'
import { useOutdatedBatch } from './use-outdated-batch'

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

describe('workspace outdated-package scan queue', () => {
  it('scans every project sequentially and counts only completed scans', async () => {
    const pending = projects.map(() => deferred<{ outdated: boolean; score?: number }>())
    const scan = vi.fn((project: RepoProject) => pending[projects.indexOf(project)].promise)
    const { result } = renderHook(useOutdatedBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, scan) })
    expect(scan).toHaveBeenCalledTimes(1)
    expect(result.current.progress).toMatchObject({ total: 3, completed: 0, succeeded: 0, outdated: 0, current: { id: 'alpha' } })
    await act(async () => { pending[0].resolve({ outdated: true, score: 0.1 }); await pending[0].promise })
    expect(scan).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toMatchObject({ completed: 1, succeeded: 1, outdated: 1, current: { id: 'bravo' } })
    await act(async () => { pending[1].resolve({ outdated: false }); await pending[1].promise })
    expect(scan).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ completed: 2, succeeded: 2, outdated: 1, current: { id: 'charlie' } })
    await act(async () => { pending[2].resolve({ outdated: true, score: 0.2 }); await job })
    expect(result.current.progress).toMatchObject({ status: 'completed', completed: 3, succeeded: 3, outdated: 2, score: 0.3, current: undefined, failures: [] })
    expect(result.current.isActive()).toBe(false)
  })

  it('continues after unsupported projects fail and preserves their explanations', async () => {
    const scan = vi.fn()
      .mockRejectedValueOnce(new Error('No package.json found.'))
      .mockRejectedValueOnce(new Error('A lockfile is required.'))
      .mockResolvedValueOnce({ outdated: true })
    const { result } = renderHook(useOutdatedBatch)
    await act(async () => { await result.current.run(projects, scan) })
    expect(scan.mock.calls.map(([project]) => project.id)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(result.current.progress).toMatchObject({
      status: 'completed', completed: 3, succeeded: 1, outdated: 1,
      failures: [{ id: 'alpha', name: 'Alpha', message: 'No package.json found.' }, { id: 'bravo', name: 'Bravo', message: 'A lockfile is required.' }],
    })
  })

  it('rejects duplicate starts synchronously and lets the current scan finish before stopping', async () => {
    const pending = deferred<{ outdated: boolean; score?: number }>()
    const scan = vi.fn(() => pending.promise)
    const { result } = renderHook(useOutdatedBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => {
      job = result.current.run(projects, scan)
      expect(result.current.isActive()).toBe(true)
      void result.current.run(projects, scan)
      result.current.dismiss()
    })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.progress?.status).toBe('running')
    act(() => { result.current.stop() })
    expect(result.current.progress?.status).toBe('stopping')
    expect(result.current.isActive()).toBe(true)
    await act(async () => { pending.resolve({ outdated: true }); await job })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.progress).toMatchObject({ status: 'stopped', completed: 1, succeeded: 1, outdated: 1, total: 3, current: undefined })
    expect(result.current.isActive()).toBe(false)
    act(() => { result.current.dismiss() })
    expect(result.current.progress).toBeUndefined()
    await act(async () => { await result.current.run([projects[1]], scan) })
    expect(result.current.progress).toMatchObject({ status: 'completed', total: 1, completed: 1 })
  })

  it('invalidates the active callback on unmount and starts no more scans', async () => {
    const pending = deferred<void>()
    let isCurrent!: () => boolean
    const scan = vi.fn((_project: RepoProject, current: () => boolean) => { isCurrent = current; return pending.promise })
    const { result, unmount } = renderHook(useOutdatedBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, scan) })
    expect(isCurrent()).toBe(true)
    unmount()
    expect(isCurrent()).toBe(false)
    await act(async () => { pending.resolve(); await job })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.isActive()).toBe(false)
  })

  it('keeps cache warnings across scan failures and clears them when a later save succeeds', async () => {
    const pending = deferred<void>()
    const scan = vi.fn()
      .mockResolvedValueOnce({ cacheWarning: true, outdated: true })
      .mockRejectedValueOnce(new Error('Registry unavailable.'))
      .mockReturnValueOnce(pending.promise)
    const { result } = renderHook(useOutdatedBatch)
    let job!: ReturnType<typeof result.current.run>
    await act(async () => { job = result.current.run(projects, scan) })
    expect(scan).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ cacheWarnings: 1, completed: 2, succeeded: 1 })
    await act(async () => { pending.resolve(); await job })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 0, succeeded: 2, outdated: 1 })
  })

  it('does not create a job for an empty workspace', async () => {
    const scan = vi.fn()
    const { result } = renderHook(useOutdatedBatch)
    await act(async () => { await result.current.run([], scan) })
    expect(scan).not.toHaveBeenCalled()
    expect(result.current.progress).toBeUndefined()
    expect(result.current.isActive()).toBe(false)
  })
})
