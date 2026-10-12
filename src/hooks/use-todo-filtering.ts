import { useMemo, useState } from 'react'
import { projectTodoOverview, type ProjectTodo } from '@/lib/project-todos'
import { projectTodoFilterGroups, projectTodoResults, type TodoFilterKey, type TodoFilters, type TodoSort } from '@/lib/project-todo-filtering'
import type { RepoProject } from '@/types'

export function useTodoFiltering(projects: RepoProject[], todos: ProjectTodo[], projectId?: string) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<TodoFilters>({})
  const [sort, setSort] = useState<TodoSort>('priority')
  const overview = useMemo(() => projectTodoOverview(projects, todos, projectId), [projects, todos, projectId])
  const filterGroups = useMemo(() => projectTodoFilterGroups(overview.visibleProjects, filters), [overview.visibleProjects, filters])
  const results = useMemo(() => projectTodoResults(overview.groups, query, filters, sort), [overview.groups, query, filters, sort])
  const hasFilters = !!query.trim() || Object.values(filters).some(values => values.length > 0)

  function setFilter(key: TodoFilterKey, values: string[]) {
    setFilters(current => ({ ...current, [key]: values }))
  }
  function toggleFilter(key: TodoFilterKey, value: string) {
    setFilters(current => ({ ...current, [key]: current[key]?.includes(value) ? current[key]!.filter(item => item !== value) : [...current[key] ?? [], value] }))
  }
  function clearFilters() { setQuery(''); setFilters({}) }

  return { overview, results, filterGroups, query, setQuery, filters, setFilter, toggleFilter, sort, setSort, hasFilters, clearFilters }
}
