// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFaviconIndicator } from '@/lib/favicon'
import { useWorkspaceFavicon } from './use-workspace-favicon'
import type { AuditSeverity, RepoProject, Workspace } from '@/types'

vi.mock('@/lib/favicon', () => ({ createFaviconIndicator: vi.fn() }))
const update = vi.fn()
const dispose = vi.fn()
const project: RepoProject = {
  id: 'app', name: 'App', dirName: 'app', relativePath: 'app', description: '',
  stack: [], scripts: {}, packageManager: 'npm', scannedAt: '',
  git: { branch: 'main', origin: 'https://github.com/example/app' },
}
const workspace: Workspace = { mode: 'helper', rootPath: '/projects', rootName: 'Projects', syncedAt: '', projects: [project] }
const stamp = (hour: number) => `2026-10-11T${String(hour).padStart(2, '0')}:00:00Z`
function audited(severity: AuditSeverity, hour = 12): RepoProject {
  return { ...project, audit: {
    manager: 'npm', scannedAt: stamp(hour),
    counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: 1 },
    findings: [{ name: 'unsafe', title: 'Unsafe input', severity }],
  } }
}
function remote(ids: number[], hour = 12): RepoProject {
  return { ...project, remoteActivity: { repository: 'https://github.com/example/app', scannedAt: stamp(hour), issues: [], pullRequests: ids } }
}
type Props = { workspace?: Workspace; projects: RepoProject[] }
const useFavicon = (props: Props) => useWorkspaceFavicon(props.workspace, props.projects)
let visible: boolean
let focused: boolean
function returnToTab() {
  act(() => {
    visible = true
    focused = true
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createFaviconIndicator).mockReturnValue({ update, dispose })
  visible = false
  focused = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('seeds restored reports without announcing cached findings or demo data', () => {
  const view = renderHook(useFavicon, { initialProps: { projects: [audited('critical')] } as Props })
  expect(update).toHaveBeenLastCalledWith(undefined)
  view.rerender({ workspace, projects: [audited('critical')] })
  expect(update).toHaveBeenLastCalledWith(undefined)
  view.rerender({ workspace, projects: [audited('critical', 13)] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
})

it('accumulates unseen categories, prioritizes vulnerabilities, and clears on return without replay', () => {
  const initial: Props = { workspace, projects: [remote([1])] }
  const view = renderHook(useFavicon, { initialProps: initial })
  const newRemote = remote([2], 13)
  view.rerender({ workspace, projects: [newRemote] })
  expect(update).toHaveBeenLastCalledWith('activity', '1 new pull/merge request')
  const warned = { ...newRemote, audit: audited('moderate', 13).audit }
  view.rerender({ workspace, projects: [warned] })
  expect(update).toHaveBeenLastCalledWith('warning', '1 new vulnerability, 1 new pull/merge request')
  const critical = { ...newRemote, audit: audited('critical', 14).audit }
  view.rerender({ workspace, projects: [critical] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability, 1 new pull/merge request')
  returnToTab()
  expect(update).toHaveBeenLastCalledWith(undefined)
  visible = false
  focused = false
  view.rerender({ workspace, projects: [{ ...critical, audit: { ...critical.audit!, scannedAt: stamp(15) } }] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
})

it('treats focused visible updates as read and visible unfocused updates as unread', () => {
  visible = true
  focused = true
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: [project] } as Props })
  view.rerender({ workspace, projects: [audited('moderate')] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
  focused = false
  view.rerender({ workspace, projects: [audited('critical', 13)] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability')
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability')
  returnToTab()
  expect(update).toHaveBeenLastCalledWith(undefined)
})

it('keeps the strongest unread severity if a finding resolves and returns before acknowledgement', () => {
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: [project] } as Props })
  view.rerender({ workspace, projects: [audited('critical')] })
  const clean = { ...audited('critical', 13), audit: {
    ...audited('critical', 13).audit!, findings: [], counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  } }
  view.rerender({ workspace, projects: [clean] })
  view.rerender({ workspace, projects: [audited('moderate', 14)] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability')
})

it('resets pending updates when switching workspace, connection mode, or disconnecting', () => {
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: [project] } as Props })
  view.rerender({ workspace, projects: [audited('high')] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability')
  view.rerender({ workspace: { ...workspace, rootPath: '/other' }, projects: [audited('high')] })
  expect(update).toHaveBeenLastCalledWith(undefined)
  view.rerender({ workspace: { ...workspace, mode: 'browser' }, projects: [audited('high')] })
  expect(update).toHaveBeenLastCalledWith(undefined)
  view.rerender({ projects: [audited('critical')] })
  expect(update).toHaveBeenLastCalledWith(undefined)
})

it('retains known findings through missing reports and baselines newly unignored projects', () => {
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: [audited('high')] } as Props })
  view.rerender({ workspace, projects: [project] })
  view.rerender({ workspace, projects: [audited('high', 13)] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
  view.rerender({ workspace, projects: [audited('critical', 14)] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability')
  view.rerender({ workspace, projects: [] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
  view.rerender({ workspace, projects: [audited('critical', 14)] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
})

it('keeps shared updates while any related active package or repository remains', () => {
  const shared = (value: RepoProject) => [
    { ...value, monorepo: { id: 'root', name: 'Root', relativePath: '.', packagePath: 'app' } },
    { ...value, id: 'sibling', monorepo: { id: 'root', name: 'Root', relativePath: '.', packagePath: 'sibling' } },
  ]
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: shared(remote([1])) } as Props })
  const latest = shared({ ...remote([2], 13), audit: audited('high', 13).audit })
  view.rerender({ workspace, projects: latest })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability, 1 new pull/merge request')
  view.rerender({ workspace, projects: [latest[0]] })
  expect(update).toHaveBeenLastCalledWith('security', '1 new vulnerability, 1 new pull/merge request')
  view.rerender({ workspace, projects: [] })
  expect(update).toHaveBeenLastCalledWith(undefined, '')
})

it('restores the document and removes event listeners through Strict Mode cleanup', () => {
  const view = renderHook(useFavicon, { initialProps: { workspace, projects: [project] } as Props, reactStrictMode: true })
  expect(createFaviconIndicator).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledOnce()
  view.rerender({ workspace, projects: [audited('high')] })
  view.unmount()
  expect(dispose).toHaveBeenCalledTimes(2)
  update.mockClear()
  returnToTab()
  expect(update).not.toHaveBeenCalled()
})
