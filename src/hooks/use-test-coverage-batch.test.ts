// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useTestCoverageBatch } from './use-test-coverage-batch'
import type { RepoProject, TestCoverageReport } from '../types'

afterEach(cleanup)
const projects: RepoProject[] = ['Alpha', 'Bravo', 'Charlie'].map(name => ({ id: name, name, dirName: name, relativePath: name,
  description: '', stack: [], scripts: { test: 'vitest run' }, packageManager: 'npm', scannedAt: '' }))
const report: TestCoverageReport = { scannedAt: '', runner: 'vitest', source: 'run', metrics: { lines: { total: 10, covered: 0, pct: 0 }, branches: null, statements: null, functions: null }, files: [] }

it('counts zero coverage, imports, and missing measurements without averaging incompatible project scopes', async () => {
  const scan = vi.fn().mockResolvedValueOnce({ report }).mockResolvedValueOnce({ report: { ...report, source: 'existing-report', warning: 'Saved report' } }).mockResolvedValueOnce({ report: { ...report, metrics: { ...report.metrics, lines: { total: 0, covered: 0, pct: null } } } })
  const { result } = renderHook(useTestCoverageBatch)
  await act(async () => { await result.current.run([...projects, { ...projects[0], id: 'unknown', scripts: {} }], scan) })
  expect(scan).toHaveBeenCalledTimes(3)
  expect(result.current.progress).toMatchObject({ status: 'completed', completed: 3, succeeded: 3, measured: 2, imported: 1, limited: 2 })
})

it('continues after failures and missing reports, retaining cache warnings until a successful save', async () => {
  const scan = vi.fn().mockResolvedValueOnce({ report, cacheWarning: true }).mockRejectedValueOnce(new Error('Test run failed')).mockResolvedValueOnce(undefined)
  const { result } = renderHook(useTestCoverageBatch)
  await act(async () => { await result.current.run(projects, scan) })
  expect(result.current.progress).toMatchObject({ completed: 3, succeeded: 1, cacheWarnings: 1, failures: [{ id: 'Bravo', name: 'Bravo', message: 'Test run failed' }, { id: 'Charlie', name: 'Charlie', message: 'The helper did not return a test coverage report.' }] })
})

it('deduplicates starts, stops after the active scan, and invalidates callbacks on unmount', async () => {
  let finish!: (value: { report: TestCoverageReport }) => void
  let current!: () => boolean
  const pending = new Promise<{ report: TestCoverageReport }>(resolve => { finish = resolve })
  const scan = vi.fn((_project: RepoProject, isCurrent: () => boolean) => { current = isCurrent; return pending })
  const { result, unmount } = renderHook(useTestCoverageBatch)
  let job!: ReturnType<typeof result.current.run>
  act(() => { job = result.current.run(projects, scan); void result.current.run(projects, scan); result.current.stop() })
  expect(scan).toHaveBeenCalledOnce()
  expect(result.current.progress?.status).toBe('stopping')
  await act(async () => { finish({ report }); await job })
  expect(scan).toHaveBeenCalledOnce()
  expect(result.current.progress).toMatchObject({ status: 'stopped', completed: 1 })
  expect(result.current.isActive()).toBe(false)
  act(() => { result.current.dismiss() })
  expect(result.current.progress).toBeUndefined()
  act(() => { job = result.current.run(projects, scan) })
  unmount()
  expect(current()).toBe(false)
  await job
  expect(scan).toHaveBeenCalledTimes(2)
})
