// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { LighthouseReport, RepoProject } from '../types'
import { useLighthouseBatch } from './use-lighthouse-batch'

afterEach(cleanup)

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(),
  description: '', stack: ['React'], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
}))
const plainProject: RepoProject = { ...projects[0], id: 'plain', name: 'Plain', stack: ['React'], scripts: {} }
const report: LighthouseReport = {
  scannedAt: '2026-10-09T12:00:00Z', version: '12.8.2', url: 'http://localhost:3000/', requestedUrl: 'http://localhost:3000/', formFactor: 'mobile',
  categories: [{ id: 'performance', title: 'Performance', score: 80 }, { id: 'accessibility', title: 'Accessibility', score: 100 }, { id: 'best-practices', title: 'Best practices', score: 100 }, { id: 'seo', title: 'SEO', score: 100 }],
  audits: [], warnings: [],
}
const finding: LighthouseReport['audits'][number] = { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', description: 'The main content rendered too slowly.', score: 0.5, scoreDisplayMode: 'numeric', categories: ['performance'] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('workspace Lighthouse scan queue', () => {
  it('scans only frontend projects sequentially and excludes unavailable scores from totals', async () => {
    const pending = projects.map(() => deferred<{ report: LighthouseReport }>())
    const scan = vi.fn((project: RepoProject) => pending[projects.indexOf(project)].promise)
    const { result } = renderHook(useLighthouseBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run([plainProject, ...projects], scan) })
    expect(scan).toHaveBeenCalledTimes(1)
    expect(result.current.progress).toMatchObject({ total: 3, completed: 0, succeeded: 0, scored: 0, current: { id: 'alpha' } })
    await act(async () => { pending[0].resolve({ report: { ...report, audits: [finding] } }); await pending[0].promise })
    expect(scan).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toMatchObject({ completed: 1, succeeded: 1, withFindings: 1, findings: 1, scored: 1, scoreTotal: 80, current: { id: 'bravo' } })
    await act(async () => { pending[1].resolve({ report: { ...report, categories: report.categories.map(category => ({ ...category, score: null })), warnings: ['Some audits were unavailable.'] } }); await pending[1].promise })
    expect(scan).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ completed: 2, succeeded: 2, limited: 1, scored: 1, scoreTotal: 80, current: { id: 'charlie' } })
    await act(async () => { pending[2].resolve({ report: { ...report, categories: report.categories.map(category => ({ ...category, score: 0 })), audits: [finding, { ...finding, score: null, scoreDisplayMode: 'error' }] } }); await job })
    expect(result.current.progress).toMatchObject({ status: 'completed', completed: 3, succeeded: 3, withFindings: 2, findings: 3, scored: 2, scoreTotal: 80, limited: 1, current: undefined, failures: [] })
    expect(result.current.isActive()).toBe(false)
  })

  it('continues after failed and missing reports without counting them as successes', async () => {
    const scan = vi.fn().mockRejectedValueOnce(new Error('Lighthouse timed out.')).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ report })
    const { result } = renderHook(useLighthouseBatch)
    await act(async () => { await result.current.run(projects, scan) })
    expect(scan.mock.calls.map(([project]) => project.id)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(result.current.progress).toMatchObject({
      status: 'completed', completed: 3, succeeded: 1, scored: 1, scoreTotal: 80,
      failures: [{ id: 'alpha', name: 'Alpha', message: 'Lighthouse timed out.' }, { id: 'bravo', name: 'Bravo', message: 'The helper did not return a Lighthouse report.' }],
    })
  })

  it('rejects duplicate starts and lets the current scan finish before stopping', async () => {
    const pending = deferred<{ report: LighthouseReport }>()
    const scan = vi.fn(() => pending.promise)
    const { result } = renderHook(useLighthouseBatch)
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
    await act(async () => { pending.resolve({ report }); await job })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.progress).toMatchObject({ status: 'stopped', completed: 1, succeeded: 1, total: 3, current: undefined })
    expect(result.current.isActive()).toBe(false)
    act(() => { result.current.dismiss() })
    expect(result.current.progress).toBeUndefined()
    await act(async () => { await result.current.run([projects[1]], scan) })
    expect(result.current.progress).toMatchObject({ status: 'completed', total: 1, completed: 1 })
  })

  it('invalidates the callback on unmount and starts no more scans', async () => {
    const pending = deferred<void>()
    let isCurrent!: () => boolean
    const scan = vi.fn((_project: RepoProject, current: () => boolean) => { isCurrent = current; return pending.promise })
    const { result, unmount } = renderHook(useLighthouseBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, scan) })
    expect(isCurrent()).toBe(true)
    unmount()
    expect(isCurrent()).toBe(false)
    await act(async () => { pending.resolve(); await job })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.isActive()).toBe(false)
  })

  it('keeps cache warnings across failures and clears them when a later save succeeds', async () => {
    const pending = deferred<{ report: LighthouseReport }>()
    const scan = vi.fn().mockResolvedValueOnce({ cacheWarning: true, report }).mockRejectedValueOnce(new Error('Scan failed.')).mockReturnValueOnce(pending.promise)
    const { result } = renderHook(useLighthouseBatch)
    let job!: ReturnType<typeof result.current.run>
    await act(async () => { job = result.current.run(projects, scan) })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 1, completed: 2, succeeded: 1 })
    await act(async () => { pending.resolve({ report }); await job })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 0, succeeded: 2 })
  })

  it('stops queued scans and invalidates callbacks when the workspace generation changes', async () => {
    const pending = deferred<{ report: LighthouseReport }>()
    const scan = vi.fn((_project: RepoProject, _isCurrent: () => boolean) => pending.promise)
    let current = true
    const { result } = renderHook(useLighthouseBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, scan, () => current) })
    const isCurrent = scan.mock.calls[0][1] as () => boolean
    expect(isCurrent()).toBe(true)
    current = false
    expect(isCurrent()).toBe(false)
    await act(async () => { pending.resolve({ report }); await job })
    expect(scan).toHaveBeenCalledOnce()
    expect(result.current.isActive()).toBe(false)
    expect(result.current.progress).toBeUndefined()
  })

  it('does not create a job when no frontend projects are available', async () => {
    const scan = vi.fn()
    const { result } = renderHook(useLighthouseBatch)
    await act(async () => { await result.current.run([plainProject], scan) })
    expect(scan).not.toHaveBeenCalled()
    expect(result.current.progress).toBeUndefined()
    expect(result.current.isActive()).toBe(false)
  })
})
