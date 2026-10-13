import { useMemo, useState } from 'react'
import { useSettings } from './use-settings'
import { matchesProjectFilters, matchesProjectSearch, projectFilterGroups, sortProjects, type ProjectFilters as FilterState, type ProjectSort } from '@/lib/project-filters'
import { tagFilterValue } from '@/lib/project-tags'
import { matchesFilterState, validCustomFilterName, type CustomFilter } from '@/lib/project-filter-state'
import { projectRepository } from '@/lib/project-worktrees'
import type { GitRepository, RepoProject } from '@/types'

type Filter = 'all' | 'favorites' | 'running'

export function useProjectFiltering(projects: RepoProject[], favorites: string[], repositories?: GitRepository[]) {
  const { settings, saveSettings } = useSettings()
  const [customFilterId, setCustomFilterId] = useState<string>()
  const [filters, setFilters] = useState<FilterState>({})
  const selectedTags = useMemo(() => new Set(filters.tags), [filters.tags])
  const filter: Filter = filters.stars?.includes('starred') ? 'favorites' : filters.server?.includes('running') ? 'running' : 'all'
  const stack = filters.stack?.length === 1 ? filters.stack[0] : null
  const [query, setQuery] = useState('')
  const [searchReset, setSearchReset] = useState(0)
  const [searchScope, setSearchScope] = useState<'all' | 'packages'>('all')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [page, setPage] = useState<'projects' | 'summary' | 'todos'>('projects')
  const currentState = { filters, query, searchScope, sort }
  const activeCustomFilter = page === 'projects' ? settings.customFilters.find(item => item.id === customFilterId && matchesFilterState(item, currentState)) : undefined

  function applyCustomFilter(preset: CustomFilter) {
    setFilters(preset.filters)
    setQuery(preset.query)
    setSearchScope(preset.searchScope)
    setSort(preset.sort)
    setSearchReset(value => value + 1)
    setCustomFilterId(preset.id)
    setPage('projects')
  }
  function saveCustomFilter(name: string) {
    if (!validCustomFilterName(name)) throw new Error('Enter a filter name of 1–80 characters.')
    const preset: CustomFilter = { ...currentState, id: crypto.randomUUID(), name: name.trim() }
    saveSettings({ ...settings, customFilters: [...settings.customFilters, preset] })
    setCustomFilterId(preset.id)
  }

  const filterContext = useMemo(() => ({ favorites, now: Date.now() }), [favorites, projects])
  const filterGroups = useMemo(() => projectFilterGroups(projects, filters, settings), [projects, filters, settings])
  const searched = useMemo(() => projects.filter(p => matchesProjectSearch(p, query, searchScope, projectRepository(p, repositories))), [projects, query, searchScope, repositories])
  const filtered = useMemo(() => sortProjects(searched.filter(p => matchesProjectFilters(p, filters, filterGroups, filterContext)), sort, favorites), [searched, filters, filterGroups, filterContext, sort, favorites])
  const hasFilters = Object.values(filters).some(values => values.length > 0)
  const hasRefinements = !!query.trim() || Object.entries(filters).some(([key, values]) => values.length > 0 && !(key === 'stars' && values[0] === 'starred') && !(key === 'server' && values[0] === 'running')) || (filter === 'favorites' && !!filters.server?.length)

  function clearFilters() { setCustomFilterId(undefined); setFilters({}); setQuery(''); setSearchReset(value => value + 1) }
  function toggleTechnology(technology: string) {
    setPage('projects')
    setFilters(current => ({ ...current, stack: current.stack?.includes(technology) ? current.stack.filter(value => value !== technology) : [...current.stack ?? [], technology] }))
  }
  function toggleTag(tag: string) {
    const value = tagFilterValue(tag)
    setFilters(current => ({ ...current, tags: current.tags?.includes(value) ? current.tags.filter(item => item !== value) : [...current.tags ?? [], value] }))
  }
  function navigate(next: Filter) {
    setCustomFilterId(undefined)
    setPage('projects')
    if (next === 'all') { clearFilters(); return }
    const key = next === 'favorites' ? 'stars' : 'server'
    const value = next === 'favorites' ? 'starred' : 'running'
    setFilters(current => ({ ...current, [key]: page === 'projects' && current[key]?.includes(value) ? [] : [value] }))
  }

  return { filters, setFilters, selectedTags, filter, stack, query, setQuery, searchReset, searchScope, setSearchScope, sort, setSort, page, setPage,
    activeCustomFilter, applyCustomFilter, saveCustomFilter,
    filterContext, filterGroups, searched, filtered, hasFilters, hasRefinements, clearFilters, toggleTechnology, toggleTag, navigate }
}
