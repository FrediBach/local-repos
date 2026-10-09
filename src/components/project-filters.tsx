import { useMemo, useRef, useState } from 'react'
import { ChevronDown, GitBranch, Package, Play, ShieldAlert, SlidersHorizontal, Star, Tag, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { filterOptionCounts, type FilterContext, type FilterGroup, type FilterOption, type FilterKey, type ProjectFilters as Filters } from '@/lib/project-filters'
import type { RepoProject } from '@/types'
import './project-filters.css'

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
}

const shortcuts = [
  { key: 'stars', value: 'starred', label: 'Starred', icon: Star },
  { key: 'audit', value: 'vulnerable', label: 'Vulnerabilities', icon: ShieldAlert },
  { key: 'outdated', value: 'outdated', label: 'Outdated packages', icon: Package },
  { key: 'git', value: 'dirty', label: 'Uncommitted', icon: GitBranch },
  { key: 'server', value: 'running', label: 'Running servers', icon: Play },
] satisfies { key: FilterKey; value: string; label: string; icon: typeof Star }[]

export function ProjectFilters({ filters, groups, projects, context, query, packageSearch, total, matching, onChange, onClearSearch, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); toggleRef.current?.focus() }
  const [technologyQuery, setTechnologyQuery] = useState('')
  const technologyTerm = (groups.find(group => group.key === 'stack')?.options.length ?? 0) > 8 ? technologyQuery.trim().toLowerCase() : ''
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
    </div>

    <ActiveFilters active={active} query={query} packageSearch={packageSearch} matching={matching} total={total}
      onClear={() => { setTechnologyQuery(''); onClear() }} onClearSearch={onClearSearch}
      onRemove={(key, value) => set(key, filters[key]!.filter(current => current !== value))} />

    {open && <section className="filter-panel" id="project-filter-panel" aria-label="Project filters" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div className="filter-panel-heading"><div><h2>Refine your projects</h2><p>Combine filters to narrow your workspace. Counts include your search and other filters.</p></div><button type="button" aria-label="Close filters" onClick={close}><X size={18} /></button></div>
      <div className="filter-sections">
        {(['Maintenance', 'Project', 'Metadata'] as const).map(section => <section className="filter-section" key={section} aria-label={`${section} filters`}>
          <h3>{section}</h3>
          {groups.filter(group => group.section === section).map(group => group.multiple ? <fieldset key={group.key} className="filter-multiple">
            <legend>{group.label}<span>Match any</span></legend>
            {group.key === 'stack' && group.options.length > 8 && <input type="search" aria-label="Find a technology" placeholder="Find a technology…" value={technologyQuery} onChange={event => setTechnologyQuery(event.target.value)} />}
            <div className="filter-choices">{group.options.filter(option => group.key !== 'stack' || !technologyTerm || option.label.toLowerCase().includes(technologyTerm) || filters.stack?.includes(option.value)).map(option => <label key={option.value} className="filter-choice"><input type="checkbox" checked={filters[group.key]?.includes(option.value) ?? false} onChange={() => toggle(group.key, option.value)} /><span>{option.label}</span><span className="filter-count" aria-hidden="true">{counts[group.key][option.value]}</span></label>)}</div>
            {group.key === 'stack' && !group.options.some(option => option.label.toLowerCase().includes(technologyTerm)) && <p className="filter-note">No matching technologies.</p>}
          </fieldset> : <label key={group.key} className="filter-field"><span>{group.label}</span><select value={filters[group.key]?.[0] ?? ''} onChange={event => set(group.key, event.target.value ? [event.target.value] : [])}>
            <option value="">Any · {counts[group.key]['']}</option>
            {group.options.map(option => <option key={option.value} value={option.value}>{option.label} · {counts[group.key][option.value]}</option>)}
          </select></label>)}
          {section === 'Maintenance' && <p className="filter-note">Based on the last saved scans and measurements. Unscanned projects are separate from clean results. Sizes may be lower bounds.</p>}
          {section === 'Project' && <p className="filter-note">Activity uses the project’s last update or commit date. Rescanning alone does not count as activity.</p>}
        </section>)}
      </div>
    </section>}
  </div>
}

function ActiveFilters({ active, query, packageSearch, matching, total, onClear, onClearSearch, onRemove }: Pick<Props, 'query' | 'packageSearch' | 'matching' | 'total' | 'onClear' | 'onClearSearch'> & {
  active: { group: FilterGroup; option: FilterOption }[]; onRemove: (key: FilterKey, value: string) => void
}) {
  if (!active.length && !query.trim()) return null
  return <div className="active-project-filters">
    <div className="filter-summary"><span aria-live="polite">{matching} of {total} {total === 1 ? 'project' : 'projects'}{query.trim() && packageSearch ? ' · matching declared packages' : ''}</span><button type="button" onClick={onClear}>Clear filters <X size={12} /></button></div>
    <div className="filter-chips" aria-label="Active filters">
      {query.trim() && <button type="button" className="filter-chip" aria-label="Remove search filter" onClick={onClearSearch}><span>{packageSearch ? 'Package' : 'Search'}: {query.trim()}</span><X size={12} /></button>}
      {active.map(({ group, option }) => <button type="button" className="filter-chip" key={`${group.key}:${option.value}`} aria-label={`Remove ${group.label}: ${option.label}`} onClick={() => onRemove(group.key, option.value)}><span>{group.label}: {option.label}</span><X size={12} /></button>)}
    </div>
  </div>
}
