import { LayoutGrid, List } from 'lucide-react'
import { projectSortOptions, type ProjectSort } from '@/lib/project-filters'
import { ProjectCommandSearch, type ProjectCommandSearchProps } from './project-command-search'
import { SortControl } from './sort-control'
import './project-search-toolbar.css'

interface Props extends ProjectCommandSearchProps {
  sort: ProjectSort
  setSort: (sort: ProjectSort) => void
  view: 'grid' | 'list'
  setView: (view: 'grid' | 'list') => void
}

export function ProjectSearchToolbar({ sort, setSort, view, setView, ...search }: Props) {
  return <div className="toolbar project-search-toolbar"><ProjectCommandSearch {...search} /><div className="toolbar-right"><SortControl label="Sort projects" value={sort} onChange={setSort} options={projectSortOptions} /><div className="view-toggle" role="group" aria-label="Project view"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={17} /></button></div></div></div>
}
