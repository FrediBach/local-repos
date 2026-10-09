// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushReminder } from './use-push-reminder'
import { defaultSettings } from '@/lib/settings'
import { dismissPushReminder, PUSH_REMINDER_DISMISSALS_KEY } from '@/lib/push-reminder'
import type { GitPushStatus, Workspace } from '@/types'

const check = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ projectPushStatus: check }))
const project = { id: 'root', name: 'Root', dirName: 'root', relativePath: 'root', description: '', stack: [], scripts: {}, packageManager: 'npm' as const, scannedAt: '' }
const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', projects: [project], syncedAt: '' }
const clean: GitPushStatus = { available: true, hasOrigin: true, originRefsKnown: true, unpushedCommits: 0, dirty: false, shallow: false, checkedAt: '' }
const pending = { ...clean, unpushedCommits: 2 }
const options = () => ({ workspace: workspace as Workspace | undefined, settings: { ...defaultSettings }, busy: false })
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 9, 17, 59))
  check.mockReset().mockResolvedValue(pending)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('end-of-day push reminder', () => {
  it('checks at the configured local time, refreshes fresh state, and clears when pushed', async () => {
    const { result } = renderHook(usePushReminder, { initialProps: options() })
    await advance(59_999)
    expect(check).not.toHaveBeenCalled()
    await advance(1)
    expect(check).toHaveBeenCalledExactlyOnceWith('root')
    expect(result.current.results[0].status?.unpushedCommits).toBe(2)
    check.mockResolvedValue(clean)
    await advance(299_999)
    expect(check).toHaveBeenCalledOnce()
    await advance(1)
    expect(result.current.results).toEqual([])
  })

  it('catches a late opening, deduplicates monorepos, and waits for other actions', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 19))
    const props = { ...options(), busy: true, workspace: { ...workspace, projects: [project, { ...project, id: 'member', monorepo: { id: 'root', name: 'Root', relativePath: 'root', packagePath: 'web' } }] } }
    const { result, rerender } = renderHook(usePushReminder, { initialProps: props })
    await advance(60_000)
    expect(check).not.toHaveBeenCalled()
    rerender({ ...props, busy: false })
    await advance(60_000)
    expect(check).toHaveBeenCalledExactlyOnceWith('root')
    expect(result.current.results).toHaveLength(1)
  })

  it('honors changed times and disables checks for browser connections, demo and disabled reminders', async () => {
    const props = options()
    const { rerender } = renderHook(usePushReminder, { initialProps: { ...props, settings: { ...props.settings, pushReminderTime: '19:00' } } })
    await advance(61 * 60_000)
    expect(check).toHaveBeenCalledOnce()
    check.mockClear()
    for (const next of [{ ...props, workspace: undefined }, { ...props, workspace: { ...workspace, mode: 'browser' as const } }, { ...props, settings: { ...props.settings, pushReminderEnabled: false } }]) {
      rerender(next)
      await advance(600_000)
      expect(check).not.toHaveBeenCalled()
    }
  })

  it('remembers dismissal through reloads for this workspace and day, then warns the next day', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 18))
    const first = renderHook(usePushReminder, { initialProps: options() })
    await advance(0)
    act(() => first.result.current.dismiss())
    expect(first.result.current.results).toEqual([])
    first.unmount()
    check.mockClear()
    const next = renderHook(usePushReminder, { initialProps: options() })
    await advance(60_000)
    expect(check).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(2026, 9, 10, 18))
    await advance(60_000)
    expect(next.result.current.results).toHaveLength(1)
  })

  it('handles cross-tab dismissal and does not revive a dismissed in-flight result', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 18))
    let finish!: (status: GitPushStatus) => void
    check.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(usePushReminder, { initialProps: options() })
    await advance(0)
    act(() => {
      dismissPushReminder('/projects')
      window.dispatchEvent(new StorageEvent('storage', { key: PUSH_REMINDER_DISMISSALS_KEY }))
    })
    await act(async () => finish(pending))
    expect(result.current.results).toEqual([])
    await advance(600_000)
    expect(check).toHaveBeenCalledOnce()
  })

  it('discards results for a replaced workspace and retries failed checks without claiming it is clean', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 18))
    let finish!: (status: GitPushStatus) => void
    check.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockRejectedValueOnce(new Error('Helper unavailable'))
    const props = options()
    const { result, rerender } = renderHook(usePushReminder, { initialProps: props })
    await advance(0)
    rerender({ ...props, workspace: { ...workspace, rootPath: '/other', projects: [{ ...project, id: 'other' }] } })
    await advance(0)
    await act(async () => finish(pending))
    expect(result.current.results).toMatchObject([{ project: { id: 'other' }, error: 'Helper unavailable' }])
    check.mockResolvedValue(clean)
    act(() => result.current.refresh())
    await advance(0)
    expect(result.current.results).toEqual([])
  })

  it('waits for visibility, detects dirty and unknown status, and resets at midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 23, 58))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    check.mockResolvedValue({ ...clean, dirty: true })
    const { result } = renderHook(usePushReminder, { initialProps: options() })
    await advance(60_000)
    expect(check).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await advance(0)
    expect(result.current.results[0].status?.dirty).toBe(true)
    check.mockResolvedValue({ ...clean, originRefsKnown: false })
    act(() => result.current.refresh())
    await advance(0)
    expect(result.current.results).toHaveLength(1)
    await advance(60_000)
    expect(result.current.results).toEqual([])
    await advance(60_000)
    expect(check).toHaveBeenCalledTimes(2)
  })
})
