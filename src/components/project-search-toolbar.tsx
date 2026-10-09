import { ArrowDownWideNarrow, ChevronDown, LayoutGrid, List } from 'lucide-react'
import { projectSortOptions, type ProjectSort } from '@/lib/project-filters'
import { ProjectCommandSearch, type ProjectCommandSearchProps } from './project-command-search'

interface Props extends ProjectCommandSearchProps {
  sort: ProjectSort
  setSort: (sort: ProjectSort) => void
  view: 'grid' | 'list'
  setView: (view: 'grid' | 'list') => void
}

export function ProjectSearchToolbar({ sort, setSort, view, setView, ...search }: Props) {
  return <div className="toolbar"><ProjectCommandSearch {...search} /><div className="toolbar-right"><label className="sort-control"><ArrowDownWideNarrow size={15} /><select value={sort} onChange={event => setSort(event.target.value as ProjectSort)} aria-label="Sort projects">{projectSortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} /></label><div className="view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={17} /></button></div></div></div>
}
