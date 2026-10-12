import { compareProjectTodos, type ProjectTodo, type ProjectTodoGroup } from './project-todos'
import type { RepoProject } from '../types'

export const todoKindLabels = { security: 'Security', outdated: 'Package updates', 'react-doctor': 'React Doctor' }
export const todoPriorityLabels = { critical: 'Critical', high: 'High priority' }
export const todoSortOptions = [
  { value: 'priority', label: 'Priority · critical first' },
  { value: 'project', label: 'Project name · A–Z' },
  { value: 'project-desc', label: 'Project name · Z–A' },
  { value: 'newest', label: 'Scan date · newest first' },
  { value: 'oldest', label: 'Scan date · oldest first' },
] as const
export type TodoSort = typeof todoSortOptions[number]['value']
export type TodoFilterKey = 'project' | 'kind' | 'priority'
export type TodoFilters = Partial<Record<TodoFilterKey, string[]>>
export interface TodoFilterGroup { key: TodoFilterKey; label: string; options: { value: string; label: string }[] }

export function projectTodoFilterGroups(projects: RepoProject[], filters: TodoFilters): TodoFilterGroup[] {
  const projectOptions = projects.map(project => ({ value: project.id, label: `${project.name} · ${project.relativePath}` }))
  const ids = new Set(projects.map(project => project.id))
  for (const value of filters.project ?? []) {
    if (!ids.has(value)) projectOptions.push({ value, label: 'Unavailable project' })
  }
  return [
    { key: 'project', label: 'Projects', options: projectOptions.sort((a, b) => a.label.localeCompare(b.label)) },
    { key: 'kind', label: 'Task type', options: Object.entries(todoKindLabels).map(([value, label]) => ({ value, label })) },
    { key: 'priority', label: 'Priority', options: Object.entries(todoPriorityLabels).map(([value, label]) => ({ value, label })) },
  ]
}

const filterKeys: TodoFilterKey[] = ['project', 'kind', 'priority']
const filterValue = (todo: ProjectTodo, key: TodoFilterKey) => key === 'project' ? todo.projectId : todo[key]
const matchesFilters = (todo: ProjectTodo, filters: TodoFilters, except?: TodoFilterKey) => filterKeys.every(key => key === except || !filters[key]?.length || filters[key]!.includes(filterValue(todo, key)))

function compareScanDates(a: ProjectTodo, b: ProjectTodo, sort: TodoSort) {
  const first = Date.parse(a.scannedAt)
  const second = Date.parse(b.scannedAt)
  if (Number.isNaN(first)) return Number.isNaN(second) ? 0 : 1
  if (Number.isNaN(second)) return -1
  return sort === 'oldest' ? first - second : second - first
}

/** Filter tasks, count alternatives in each facet, and sort copies within project groups. */
export function projectTodoResults(groups: ProjectTodoGroup[], query: string, filters: TodoFilters, sort: TodoSort) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const counts: Record<TodoFilterKey, Record<string, number>> = { project: {}, kind: {}, priority: {} }
  const matching: ProjectTodoGroup[] = []
  const byDate = sort === 'newest' || sort === 'oldest'
  const compareTasks = (a: ProjectTodo, b: ProjectTodo) => (byDate ? compareScanDates(a, b, sort) : 0) || compareProjectTodos(a, b)

  for (const { project, todos } of groups) {
    const projectText = [project.name, project.dirName, project.relativePath, project.description, ...project.stack, ...project.tags ?? []].join(' ').toLowerCase()
    const visible: ProjectTodo[] = []
    for (const todo of todos) {
      const text = [projectText, todo.title, todo.description, todoKindLabels[todo.kind], todoPriorityLabels[todo.priority]].join(' ').toLowerCase()
      if (!terms.every(term => text.includes(term))) continue
      for (const key of filterKeys) {
        if (matchesFilters(todo, filters, key)) {
          const value = filterValue(todo, key)
          counts[key][value] = (counts[key][value] ?? 0) + 1
        }
      }
      if (matchesFilters(todo, filters)) visible.push(todo)
    }
    if (visible.length) matching.push({ project, todos: visible.sort(compareTasks) })
  }
  matching.sort((a, b) => {
    const byName = a.project.name.localeCompare(b.project.name) || a.project.relativePath.localeCompare(b.project.relativePath) || a.project.id.localeCompare(b.project.id)
    if (sort === 'project' || sort === 'project-desc') return sort === 'project-desc' ? -byName : byName
    return compareTasks(a.todos[0], b.todos[0]) || byName
  })
  return { groups: matching, counts, matching: matching.reduce((total, group) => total + group.todos.length, 0) }
}
