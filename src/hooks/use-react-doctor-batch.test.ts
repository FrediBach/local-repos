// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactDoctorReport, RepoProject, ScanProgressReporter } from '../types'
import { useReactDoctorBatch } from './use-react-doctor-batch'

afterEach(cleanup)

const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({
  id: name.toLowerCase(), name, dirName: name.toLowerCase(), relativePath: name.toLowerCase(),
  description: '', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
}))
const plainProject: RepoProject = { ...projects[0], id: 'plain', name: 'Plain', stack: ['Vue'] }
const report: ReactDoctorReport = { scannedAt: '2026-10-09T12:00:00Z', version: '0.9.17', score: 80, label: 'Good', findings: [] }
const finding: ReactDoctorReport['findings'][number] = { filePath: 'src/App.tsx', line: 12, column: 3, rule: 'no-array-index-as-key', plugin: 'react-doctor', severity: 'warning', message: 'Avoid array index keys.', help: 'Use a stable key.', category: 'Performance' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('workspace React Doctor scan queue', () => {
  it('reports real phases while stopping and drops progress from previous projects and workspaces', async () => {
    const pending = projects.map(() => deferred<{ report: ReactDoctorReport }>())
    const reporters: ScanProgressReporter[] = []
    const scan = vi.fn((project: RepoProject, _current: () => boolean, reportProgress: ScanProgressReporter) => {
      reporters.push(reportProgress)
      return pending[projects.indexOf(project)].promise
    })
    const { result } = renderHook(useReactDoctorBatch)
    let current = true
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run(projects, scan, () => current) })
    act(() => { reporters[0]({ phase: 'Analyzing source', detail: 'Linting React components' }) })
    expect(result.current.progress).toMatchObject({ stage: { phase: 'Analyzing source' }, completed: 0 })
    await act(async () => { pending[0].resolve({ report }); await pending[0].promise })
    act(() => { reporters[0]({ phase: 'Late phase' }) })
    expect(result.current.progress).toMatchObject({ current: { id: 'bravo' }, stage: { phase: 'Preparing scan' } })
    act(() => { result.current.stop(); reporters[1]({ phase: 'Calculating score' }) })
    expect(result.current.progress).toMatchObject({ status: 'stopping', stage: { phase: 'Calculating score' } })
    current = false
    act(() => { reporters[1]({ phase: 'Old workspace' }) })
    expect(result.current.progress?.stage?.phase).toBe('Calculating score')
    await act(async () => { pending[1].resolve({ report }); await job })
    expect(scan).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toBeUndefined()
  })

  it('scans only React projects sequentially and excludes unavailable scores from totals', async () => {
    const pending = projects.map(() => deferred<{ report: ReactDoctorReport }>())
    const scan = vi.fn((project: RepoProject) => pending[projects.indexOf(project)].promise)
    const { result } = renderHook(useReactDoctorBatch)
    let job!: ReturnType<typeof result.current.run>
    act(() => { job = result.current.run([plainProject, ...projects], scan) })
    expect(scan).toHaveBeenCalledTimes(1)
    expect(result.current.progress).toMatchObject({ total: 3, completed: 0, succeeded: 0, scored: 0, current: { id: 'alpha' } })
    await act(async () => { pending[0].resolve({ report: { ...report, findings: [finding] } }); await pending[0].promise })
    expect(scan).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toMatchObject({ completed: 1, succeeded: 1, withFindings: 1, findings: 1, scored: 1, scoreTotal: 80, current: { id: 'bravo' } })
    await act(async () => { pending[1].resolve({ report: { ...report, score: null, label: 'Incomplete scan', warning: 'Linting was unavailable.' } }); await pending[1].promise })
    expect(scan).toHaveBeenCalledTimes(3)
    expect(result.current.progress).toMatchObject({ completed: 2, succeeded: 2, limited: 1, scored: 1, scoreTotal: 80, current: { id: 'charlie' } })
    await act(async () => { pending[2].resolve({ report: { ...report, score: 0, findings: [finding, finding] } }); await job })
    expect(result.current.progress).toMatchObject({ status: 'completed', completed: 3, succeeded: 3, withFindings: 2, findings: 3, scored: 2, scoreTotal: 80, limited: 1, current: undefined, failures: [] })
    expect(result.current.isActive()).toBe(false)
  })

  it('continues after failed and missing reports without counting them as successes', async () => {
    const scan = vi.fn().mockRejectedValueOnce(new Error('React Doctor timed out.')).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ report })
    const { result } = renderHook(useReactDoctorBatch)
    await act(async () => { await result.current.run(projects, scan) })
    expect(scan.mock.calls.map(([project]) => project.id)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(result.current.progress).toMatchObject({
      status: 'completed', completed: 3, succeeded: 1, scored: 1, scoreTotal: 80,
      failures: [{ id: 'alpha', name: 'Alpha', message: 'React Doctor timed out.' }, { id: 'bravo', name: 'Bravo', message: 'The helper did not return a React Doctor report.' }],
    })
  })

  it('rejects duplicate starts and lets the current scan finish before stopping', async () => {
    const pending = deferred<{ report: ReactDoctorReport }>()
    const scan = vi.fn(() => pending.promise)
    const { result } = renderHook(useReactDoctorBatch)
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
    const { result, unmount } = renderHook(useReactDoctorBatch)
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
    const pending = deferred<{ report: ReactDoctorReport }>()
    const scan = vi.fn().mockResolvedValueOnce({ cacheWarning: true, report }).mockRejectedValueOnce(new Error('Scan failed.')).mockReturnValueOnce(pending.promise)
    const { result } = renderHook(useReactDoctorBatch)
    let job!: ReturnType<typeof result.current.run>
    await act(async () => { job = result.current.run(projects, scan) })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 1, completed: 2, succeeded: 1 })
    await act(async () => { pending.resolve({ report }); await job })
    expect(result.current.progress).toMatchObject({ cacheWarnings: 0, succeeded: 2 })
  })

  it('does not create a job when no React projects are available', async () => {
    const scan = vi.fn()
    const { result } = renderHook(useReactDoctorBatch)
    await act(async () => { await result.current.run([plainProject], scan) })
    expect(scan).not.toHaveBeenCalled()
    expect(result.current.progress).toBeUndefined()
    expect(result.current.isActive()).toBe(false)
  })
})
