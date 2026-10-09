// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_TODO_DISMISSALS_KEY, useProjectTodos } from './use-project-todos'
import type { AuditFinding, PackageAudit, RepoProject, Workspace } from '@/types'

const project: RepoProject = { id: 'app', name: 'App', dirName: 'app', relativePath: 'app', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' }
const high: AuditFinding = { name: 'unsafe', severity: 'high', title: 'Unsafe input' }
const other: AuditFinding = { ...high, name: 'another' }
const audit = (findings: AuditFinding[]): PackageAudit => ({ manager: 'npm', scannedAt: '2026-10-09', findings, counts: { info: 0, low: 0, moderate: 0, high: findings.filter(finding => finding.severity === 'high').length, critical: findings.filter(finding => finding.severity === 'critical').length } })
const workspace: Workspace = { mode: 'helper', rootName: 'Projects', rootPath: '/projects', projects: [], syncedAt: '' }
const props = (findings = [high]) => ({ projects: [{ ...project, audit: audit(findings) }] as RepoProject[], workspace })
const useTodos = ({ projects, workspace: source }: ReturnType<typeof props>) => useProjectTodos(projects, source)

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('persistent automatic todos', () => {
  it('remembers dismissal across reloads and identical rescans, including reordered subsets', () => {
    const first = renderHook(useTodos, { initialProps: props([high, other]) })
    expect(first.result.current.counts).toEqual({ app: 1 })
    act(() => first.result.current.dismiss(first.result.current.todos[0]))
    expect(first.result.current.todos).toEqual([])
    expect(first.result.current.counts.app).toBe(0)
    first.unmount()
    const next = renderHook(useTodos, { initialProps: props([other, high]) })
    expect(next.result.current.todos).toEqual([])
    next.rerender(props([high]))
    expect(next.result.current.todos).toEqual([])
    next.rerender({ ...props([high]), projects: [{ ...project, audit: { ...audit([high]), scannedAt: 'later' } }] })
    expect(next.result.current.todos).toEqual([])
  })

  it('resurfaces new findings and critical escalation without dismissing a newer report through a stale task', () => {
    const view = renderHook(useTodos, { initialProps: props() })
    const original = view.result.current.todos[0]
    act(() => view.result.current.dismiss(original))
    view.rerender(props([high, other]))
    expect(view.result.current.todos).toHaveLength(1)
    act(() => view.result.current.dismiss(original))
    expect(view.result.current.todos).toHaveLength(1)
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    view.rerender(props([{ ...high, severity: 'critical' }]))
    expect(view.result.current.todos[0].priority).toBe('critical')
  })

  it('retires dismissals after successful resolution and shows a later recurrence', () => {
    const view = renderHook(useTodos, { initialProps: props() })
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    view.rerender(props([]))
    expect(view.result.current.todos).toEqual([])
    view.unmount()
    const reopened = renderHook(useTodos, { initialProps: props() })
    expect(reopened.result.current.todos).toHaveLength(1)
  })

  it('keeps dismissals when a report is invalidated or a project is temporarily absent', () => {
    const view = renderHook(useTodos, { initialProps: props() })
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    view.rerender({ ...props(), projects: [project] })
    view.rerender({ ...props(), projects: [] })
    view.rerender(props())
    expect(view.result.current.todos).toEqual([])
  })

  it('does not interpret incomplete React Doctor scans as resolved errors', () => {
    const report = { scannedAt: '2026-10-09', version: '1', score: 60, label: 'Good', findings: [{ filePath: 'src/App.tsx', line: 1, column: 1, plugin: 'react', rule: 'hooks', severity: 'error' as const, message: 'Hook error', help: '', category: 'React' }] }
    const source = { ...props(), projects: [{ ...project, reactDoctor: report }] as RepoProject[] }
    const view = renderHook(useTodos, { initialProps: source })
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    view.rerender({ ...source, projects: [{ ...project, reactDoctor: { ...report, findings: [], score: null, label: 'Incomplete scan', warning: 'Some checks did not finish.' } }] })
    view.rerender(source)
    expect(view.result.current.todos).toEqual([])
    view.rerender({ ...source, projects: [{ ...project, reactDoctor: { ...report, findings: [] } }] })
    view.rerender(source)
    expect(view.result.current.todos).toHaveLength(1)
  })

  it('does not let an older cached scan clear dismissals made from a newer report', () => {
    const newest = { ...props(), projects: [{ ...project, audit: { ...audit([high]), scannedAt: '2026-10-09T12:00:00Z' } }] }
    const current = renderHook(useTodos, { initialProps: newest })
    act(() => current.result.current.dismiss(current.result.current.todos[0]))
    const saved = localStorage.getItem(PROJECT_TODO_DISMISSALS_KEY)
    current.unmount()
    const stale = renderHook(useTodos, { initialProps: { ...props(), projects: [{ ...project, audit: { ...audit([]), scannedAt: '2026-10-08T12:00:00Z' } }] } })
    expect(localStorage.getItem(PROJECT_TODO_DISMISSALS_KEY)).toBe(saved)
    stale.rerender(newest)
    expect(stale.result.current.todos).toEqual([])
  })

  it('isolates dismissals by workspace and project, and restores them on returning to a workspace', () => {
    const initial = { ...props(), projects: [{ ...project, audit: audit([high]) }, { ...project, id: 'second', audit: audit([high]) }] }
    const view = renderHook(useTodos, { initialProps: initial })
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    expect(view.result.current.counts).toEqual({ app: 0, second: 1 })
    view.rerender({ ...initial, workspace: { ...workspace, rootPath: '/other' } })
    expect(view.result.current.todos).toHaveLength(2)
    view.rerender(initial)
    expect(view.result.current.todos).toHaveLength(1)
    expect(view.result.current.todos[0].projectId).toBe('second')
  })

  it('keeps count-only reductions dismissed and surfaces count growth', () => {
    const report = { ...audit([]), counts: { ...audit([]).counts, high: 3 } }
    const source = { ...props(), projects: [{ ...project, audit: report }] }
    const view = renderHook(useTodos, { initialProps: source })
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    view.rerender({ ...source, projects: [{ ...project, audit: { ...report, counts: { ...report.counts, high: 2 } } }] })
    expect(view.result.current.todos).toEqual([])
    view.rerender(source)
    expect(view.result.current.todos).toHaveLength(1)
  })

  it('retains a session dismissal and reports storage failure without crashing', () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('Unavailable') })
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Unavailable') })
    const view = renderHook(useTodos, { initialProps: props() })
    expect(view.result.current.storageError).toBe(true)
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    expect(view.result.current.todos).toEqual([])
    expect(view.result.current.storageError).toBe(true)
  })

  it('handles corrupt data and cross-tab storage updates without writing them back', () => {
    localStorage.setItem(PROJECT_TODO_DISMISSALS_KEY, 'invalid')
    const view = renderHook(useTodos, { initialProps: props() })
    expect(view.result.current.storageError).toBe(true)
    act(() => view.result.current.dismiss(view.result.current.todos[0]))
    expect(view.result.current.storageError).toBe(false)
    const saved = localStorage.getItem(PROJECT_TODO_DISMISSALS_KEY)!
    localStorage.setItem(PROJECT_TODO_DISMISSALS_KEY, '{}')
    vi.mocked(localStorage.setItem).mockClear()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: PROJECT_TODO_DISMISSALS_KEY })))
    expect(view.result.current.todos).toHaveLength(1)
    expect(localStorage.setItem).not.toHaveBeenCalled()
    localStorage.setItem(PROJECT_TODO_DISMISSALS_KEY, saved)
    vi.mocked(localStorage.setItem).mockClear()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: PROJECT_TODO_DISMISSALS_KEY })))
    expect(view.result.current.todos).toEqual([])
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
