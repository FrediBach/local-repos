import { useId, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { ActiveListFilters, FilterMultiSelect } from './list-filters'
import { SortControl } from './sort-control'
import { todoSortOptions } from '@/lib/project-todo-filtering'
import type { useTodoFiltering } from '@/hooks/use-todo-filtering'

export function TodoFilters({ filtering }: { filtering: ReturnType<typeof useTodoFiltering> }) {
  const id = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const { query, setQuery, filters, filterGroups, setFilter, toggleFilter, sort, setSort, results, overview, clearFilters } = filtering
  const active = filterGroups.flatMap(group => group.options.filter(option => filters[group.key]?.includes(option.value)).map(option => ({
    id: `${group.key}:${option.value}`, label: `${group.label}: ${option.label}`, onRemove: () => toggleFilter(group.key, option.value),
  })))
  function clear() { clearFilters(); searchRef.current?.focus() }
  function clearSearch() { setQuery(''); searchRef.current?.focus() }

  return <div className="todos-controls" role="search" aria-label="Find todos">
    <div className="toolbar todos-toolbar">
      <div className="search-box"><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Search todos" aria-describedby={`${id}-hint`} placeholder="Search todos or projects…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear todo search" onClick={clearSearch}><X size={14} aria-hidden="true" /></button>}</div>
      <SortControl label="Sort todos" value={sort} onChange={setSort} options={todoSortOptions} />
    </div>
    <span id={`${id}-hint`} className="sr-only">Search task titles, descriptions, types, priorities, project names, paths, technologies, and tags.</span>
    <div className="todos-filter-fields" role="group" aria-label="Todo filters">
      {filterGroups.map(group => <FilterMultiSelect key={group.key} group={group} selected={filters[group.key] ?? []} counts={results.counts[group.key]} onToggle={value => toggleFilter(group.key, value)} onClear={() => setFilter(group.key, [])} />)}
    </div>
    <ActiveListFilters active={active} query={query} summary={`${results.matching} of ${overview.visibleTodos.length} ${overview.visibleTodos.length === 1 ? 'todo' : 'todos'}`} onClear={clear} onClearSearch={clearSearch} />
  </div>
}
