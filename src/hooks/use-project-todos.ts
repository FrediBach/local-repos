import { useEffect, useMemo, useState } from 'react'
import { projectTodoId, projectTodos, type ProjectTodo } from '@/lib/project-todos'
import type { RepoProject, Workspace } from '@/types'

export const PROJECT_TODO_DISMISSALS_KEY = 'local-repos:project-todo-dismissals:v1'
interface Dismissal { findingKeys: string[]; scannedAt: string }
type Dismissals = Record<string, Dismissal>

function isDismissal(value: unknown): value is Dismissal {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<Dismissal>
  return typeof record.scannedAt === 'string' && Array.isArray(record.findingKeys) && record.findingKeys.every(key => typeof key === 'string')
}

function readDismissals(): { dismissals: Dismissals; storageError: boolean } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROJECT_TODO_DISMISSALS_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid todo dismissals')
    return {
      dismissals: Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Dismissal] => isDismissal(entry[1]))),
      storageError: false,
    }
  } catch { return { dismissals: {}, storageError: true } }
}

const dismissalKey = (scope: string, id: string) => JSON.stringify([scope, id])
const olderReport = (scannedAt: string, dismissedAt: string) => Date.parse(scannedAt) < Date.parse(dismissedAt)

/** Retire resolved findings only when that scan actually has a report. */
function reconcileDismissals(dismissals: Dismissals, projects: RepoProject[], todos: ProjectTodo[], scope: string): Dismissals {
  let next = dismissals
  const findings = new Map(todos.map(todo => [todo.id, new Set(todo.findingKeys)]))
  for (const project of projects) {
    for (const [kind, report] of [['security', project.audit], ['outdated', project.outdated], ['react-doctor', project.reactDoctor]] as const) {
      if (!report) continue
      // Partial analysis cannot establish that previously known errors are gone.
      if (kind === 'react-doctor' && project.reactDoctor && (project.reactDoctor.label === 'Incomplete scan'
        || project.reactDoctor.warning?.includes('no supported source files'))) continue
      const id = projectTodoId(project.id, kind)
      const key = dismissalKey(scope, id)
      const previous = dismissals[key]
      if (!previous || olderReport(report.scannedAt, previous.scannedAt)) continue
      const remaining = previous.findingKeys.filter(finding => findings.get(id)?.has(finding))
      if (remaining.length === previous.findingKeys.length) continue
      if (next === dismissals) next = { ...dismissals }
      if (remaining.length) next[key] = { findingKeys: remaining, scannedAt: report.scannedAt }
      else delete next[key]
    }
  }
  return next
}

export function useProjectTodos(projects: RepoProject[], workspace?: Workspace): {
  todos: ProjectTodo[]
  counts: Record<string, number>
  dismiss: (todo: ProjectTodo) => void
  storageError: boolean
} {
  const scope = JSON.stringify([workspace?.mode ?? 'demo', workspace?.rootPath ?? workspace?.rootName ?? 'demo'])
  const [loaded] = useState(readDismissals)
  const [dismissals, setDismissals] = useState(loaded.dismissals)
  const [storageError, setStorageError] = useState(loaded.storageError)
  const candidates = useMemo(() => projectTodos(projects), [projects])

  useEffect(() => {
    setDismissals(previous => reconcileDismissals(previous, projects, candidates, scope))
  }, [candidates, projects, scope])

  useEffect(() => {
    if (dismissals === loaded.dismissals) return
    try {
      const serialized = JSON.stringify(dismissals)
      if (localStorage.getItem(PROJECT_TODO_DISMISSALS_KEY) !== serialized) localStorage.setItem(PROJECT_TODO_DISMISSALS_KEY, serialized)
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [dismissals, loaded])

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== PROJECT_TODO_DISMISSALS_KEY && event.key !== null) return
      const next = readDismissals()
      setStorageError(next.storageError)
      if (!next.storageError) setDismissals(next.dismissals)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  const todos = candidates.filter(todo => {
    const dismissed = new Set(dismissals[dismissalKey(scope, todo.id)]?.findingKeys ?? [])
    return todo.findingKeys.some(key => !dismissed.has(key))
  })
  const counts: Record<string, number> = Object.fromEntries(projects.map(project => [project.id, 0]))
  for (const todo of todos) counts[todo.projectId]++

  return { todos, counts, storageError, dismiss: todo => {
    // A stale dialog must not dismiss newer findings that arrived in a rescan.
    const key = dismissalKey(scope, todo.id)
    setDismissals(previous => ({ ...previous, [key]: {
      findingKeys: [...new Set([...(previous[key]?.findingKeys ?? []), ...todo.findingKeys])],
      scannedAt: previous[key] && olderReport(todo.scannedAt, previous[key].scannedAt) ? previous[key].scannedAt : todo.scannedAt,
    } }))
  } }
}
