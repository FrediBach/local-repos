import type { Ref } from 'react'
import { ArrowDownWideNarrow, ChevronDown, LayoutGrid, List, Search, X } from 'lucide-react'
import { projectSortOptions, type ProjectSort } from '@/lib/project-filters'

interface Props {
  searchRef: Ref<HTMLInputElement>
  query: string
  setQuery: (query: string) => void
  searchScope: 'all' | 'packages'
  setSearchScope: (scope: 'all' | 'packages') => void
  sort: ProjectSort
  setSort: (sort: ProjectSort) => void
  view: 'grid' | 'list'
  setView: (view: 'grid' | 'list') => void
}

export function ProjectSearchToolbar({ searchRef, query, setQuery, searchScope, setSearchScope, sort, setSort, view, setView }: Props) {
  return <div className="toolbar"><div className="search-group"><select className="search-scope" aria-label="Search scope" value={searchScope} onChange={event => setSearchScope(event.target.value as 'all' | 'packages')}><option value="all">Projects & packages</option><option value="packages">Package name & version</option></select><div className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchScope === 'packages' ? 'e.g. next, next@16.0.0, next@16.*.*…' : 'Find a project or package…'} aria-label="Search projects" />{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>⌘ K</kbd>}</div></div><div className="toolbar-right"><label className="sort-control"><ArrowDownWideNarrow size={15} /><select value={sort} onChange={event => setSort(event.target.value as ProjectSort)} aria-label="Sort projects">{projectSortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} /></label><div className="view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={17} /></button></div></div></div>
}
