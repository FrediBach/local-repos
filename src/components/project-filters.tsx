import { useMemo, useRef, useState } from 'react'
import { ChevronDown, GitBranch, Package, Play, ShieldAlert, SlidersHorizontal, Star, Tag, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { filterOptionCounts, type FilterContext, type FilterGroup, type FilterKey, type ProjectFilters as Filters } from '@/lib/project-filters'
import type { RepoProject } from '@/types'
import './project-filters.css'
import { SaveFilterDialog } from './save-filter-dialog'
import { ActiveListFilters, FilterMultiSelect } from './list-filters'

interface Props {
  filters: Filters
  groups: FilterGroup[]
  projects: RepoProject[]
  context: FilterContext
  query: string
  packageSearch: boolean
  total: number
  matching: number
  onChange: (filters: Filters) => void
  onClearSearch: () => void
  onClear: () => void
  onSave: (name: string) => void
}

const shortcuts = [
  { key: 'stars', value: 'starred', label: 'Starred', icon: Star },
  { key: 'audit', value: 'vulnerable', label: 'Vulnerabilities', icon: ShieldAlert },
  { key: 'outdated', value: 'outdated', label: 'Outdated packages', icon: Package },
  { key: 'git', value: 'dirty', label: 'Uncommitted', icon: GitBranch },
  { key: 'server', value: 'running', label: 'Running servers', icon: Play },
] satisfies { key: FilterKey; value: string; label: string; icon: typeof Star }[]

export function ProjectFilters({ filters, groups, projects, context, query, packageSearch, total, matching, onChange, onClearSearch, onClear, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); toggleRef.current?.focus() }
  const counts = useMemo(() => filterOptionCounts(projects, filters, groups, context), [projects, filters, groups, context])
  const active = groups.flatMap(group => group.options.filter(option => filters[group.key]?.includes(option.value)).map(option => ({ group, option })))
  const tagOptions = groups.find(group => group.key === 'tags')?.options ?? []
  const selectedTags = new Set(filters.tags)
  const set = (key: FilterKey, values: string[]) => {
    const next = { ...filters }
    if (values.length) next[key] = values
    else delete next[key]
    onChange(next)
  }
  const toggle = (key: FilterKey, value: string) => set(key, filters[key]?.includes(value) ? filters[key]!.filter(current => current !== value) : [...filters[key] ?? [], value])

  return <div className="project-filters">
    <div className="filter-shortcuts" role="group" aria-label="Quick filters">
      <DropdownMenu modal={false}><DropdownMenuTrigger asChild><button type="button" className="filter-shortcut tag-filter-trigger" data-active={!!filters.tags?.length}><Tag size={14} aria-hidden="true" /><span>Tags</span>{!!filters.tags?.length && <span className="filter-count">{filters.tags.length}</span>}<ChevronDown size={13} /></button></DropdownMenuTrigger><DropdownMenuContent className="tag-filter-menu" align="start" aria-label="Filter by tags">
        <div className="tag-filter-heading">Match any tag</div>
        {tagOptions.map(option => <DropdownMenuCheckboxItem key={option.value} checked={selectedTags.has(option.value)} onSelect={event => event.preventDefault()} onCheckedChange={() => toggle('tags', option.value)}><span className="tag-filter-name">{option.label}</span><span className="filter-count" aria-hidden="true">{counts.tags[option.value]}</span></DropdownMenuCheckboxItem>)}
        {tagOptions.length === 1 && <p className="tag-filter-hint">Use Add tags on a project to get started.</p>}
        {!!filters.tags?.length && <DropdownMenuItem className="tag-filter-clear" onSelect={() => set('tags', [])}><X size={14} />Clear tag filters</DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu>
      {shortcuts.map(({ key, value, label, icon: Icon }) => <button key={key} type="button" className="filter-shortcut" aria-pressed={filters[key]?.includes(value) ?? false} onClick={() => set(key, filters[key]?.includes(value) ? [] : [value])}>
        <Icon size={14} aria-hidden="true" /><span>{label}</span><span className="filter-count" aria-hidden="true">{counts[key][value]}</span>
      </button>)}
      <button type="button" className="filter-expand" ref={toggleRef} aria-expanded={open} aria-controls="project-filter-panel" onClick={() => setOpen(!open)}><SlidersHorizontal size={15} />All filters{active.length > 0 && <span className="filter-count">{active.length}</span>}<ChevronDown size={13} className={open ? 'is-open' : ''} /></button>
      <SaveFilterDialog onSave={onSave} />
    </div>

    <ActiveListFilters active={active.map(({ group, option }) => ({ id: `${group.key}:${option.value}`, label: `${group.label}: ${option.label}`, onRemove: () => set(group.key, filters[group.key]!.filter(current => current !== option.value)) }))}
      query={query} searchLabel={packageSearch ? 'Package' : 'Search'} summary={`${matching} of ${total} ${total === 1 ? 'project' : 'projects'}${query.trim() && packageSearch ? ' · matching declared packages' : ''}`}
      onClear={onClear} onClearSearch={onClearSearch} />

    {open && <section className="filter-panel" id="project-filter-panel" aria-label="Project filters" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div className="filter-panel-heading"><h2>Filters</h2><button type="button" aria-label="Close filters" onClick={close}><X size={18} /></button></div>
      <div className="filter-sections">
        {(['Maintenance', 'Project', 'Metadata'] as const).map(section => <section className="filter-section" key={section} aria-label={`${section} filter group`}>
          <h3>{section}</h3>
          {groups.filter(group => group.section === section).map(group => group.multiple ? <FilterMultiSelect key={group.key} group={group} searchLabel={group.key === 'stack' ? 'Find a technology' : undefined} selected={filters[group.key] ?? []} counts={counts[group.key]} onToggle={value => toggle(group.key, value)} onClear={() => set(group.key, [])} /> : <label key={group.key} className="filter-field"><span>{group.label}</span><select data-active={!!filters[group.key]?.length} value={filters[group.key]?.[0] ?? ''} onChange={event => set(group.key, event.target.value ? [event.target.value] : [])}>
            <option value="">Any</option>
            {group.options.map(option => <option key={option.value} value={option.value}>{option.label} · {counts[group.key][option.value]}</option>)}
          </select></label>)}
        </section>)}
      </div>
    </section>}
  </div>
}
