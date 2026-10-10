// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useScanProgress } from './use-scan-progress'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps phase elapsed time while counts change and resets it for the next phase', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const { result } = renderHook(useScanProgress)
  let scan!: ReturnType<typeof result.current.begin>
  act(() => { scan = result.current.begin('Running React Doctor', () => true, { id: 'alpha', name: 'Alpha' }) })
  clock.mockReturnValue(2000)
  act(() => { scan.report({ phase: 'Analyzing source', completed: 1, total: 10 }) })
  clock.mockReturnValue(3000)
  act(() => { scan.report({ phase: 'Analyzing source', completed: 5, total: 10 }) })
  expect(result.current.progress).toMatchObject({ projectId: 'alpha', stage: { completed: 5 }, startedAt: 1000, stageStartedAt: 2000 })
  act(() => { scan.report({ phase: 'Calculating score' }) })
  expect(result.current.progress?.stageStartedAt).toBe(3000)
})

it('ignores stale reporters and finish callbacks after another scan starts', () => {
  const { result, unmount } = renderHook(useScanProgress)
  let first!: ReturnType<typeof result.current.begin>
  let second!: ReturnType<typeof result.current.begin>
  let current = true
  act(() => { first = result.current.begin('First', () => current) })
  current = false
  act(() => { first.report({ phase: 'Old workspace result' }) })
  expect(result.current.progress?.stage.phase).toBe('Preparing scan')
  act(() => { second = result.current.begin('Second', () => true) })
  act(() => { first.report({ phase: 'Old request result' }); first.finish() })
  expect(result.current.progress?.title).toBe('Second')
  act(() => { second.finish(); second.report({ phase: 'Late callback' }) })
  expect(result.current.progress).toBeUndefined()
  unmount()
  second.report({ phase: 'Unmounted callback' })
})
