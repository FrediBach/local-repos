import { useId, useMemo, useRef, useState } from 'react'
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
      onClear={onClear} onClearSearch={onClearSearch}
      onRemove={(key, value) => set(key, filters[key]!.filter(current => current !== value))} />

    {open && <section className="filter-panel" id="project-filter-panel" aria-label="Project filters" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div className="filter-panel-heading"><h2>Filters</h2><button type="button" aria-label="Close filters" onClick={close}><X size={18} /></button></div>
      <div className="filter-sections">
        {(['Maintenance', 'Project', 'Metadata'] as const).map(section => <section className="filter-section" key={section} aria-label={`${section} filter group`}>
          <h3>{section}</h3>
          {groups.filter(group => group.section === section).map(group => group.multiple ? <FilterMultiSelect key={group.key} group={group} selected={filters[group.key] ?? []} counts={counts[group.key]} onToggle={value => toggle(group.key, value)} onClear={() => set(group.key, [])} /> : <label key={group.key} className="filter-field"><span>{group.label}</span><select data-active={!!filters[group.key]?.length} value={filters[group.key]?.[0] ?? ''} onChange={event => set(group.key, event.target.value ? [event.target.value] : [])}>
            <option value="">Any</option>
            {group.options.map(option => <option key={option.value} value={option.value}>{option.label} · {counts[group.key][option.value]}</option>)}
          </select></label>)}
        </section>)}
      </div>
    </section>}
  </div>
}

function FilterMultiSelect({ group, selected, counts, onToggle, onClear }: {
  group: FilterGroup; selected: string[]; counts: Record<string, number>; onToggle: (value: string) => void; onClear: () => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchable = group.options.length > 8
  const term = searchable ? query.trim().toLowerCase() : ''
  const matches = group.options.filter(option => option.label.toLowerCase().includes(term))
  const options = group.options.filter(option => matches.includes(option) || selected.includes(option.value))
  const summary = group.options.filter(option => selected.includes(option.value)).map(option => option.label).join(', ') || 'Any'
  const searchLabel = group.key === 'stack' ? 'Find a technology' : `Find ${group.label.toLowerCase()}`

  return <div className="filter-field">
    <span id={`${id}-label`}>{group.label}</span>
    <DropdownMenu modal={false} open={open} onOpenChange={value => { setOpen(value); setQuery('') }}>
      <DropdownMenuTrigger asChild><button type="button" className="filter-select" data-active={selected.length > 0} aria-labelledby={`${id}-label ${id}-value`} title={summary}>
        <span id={`${id}-value`}>{summary}</span>{selected.length > 1 && <span className="filter-count" aria-hidden="true">{selected.length}</span>}<ChevronDown size={16} aria-hidden="true" />
      </button></DropdownMenuTrigger>
      <DropdownMenuContent className="filter-select-menu" align="start" aria-label={`Filter by ${group.label.toLowerCase()}`} aria-labelledby={undefined} onEscapeKeyDown={event => event.stopPropagation()} onKeyDownCapture={event => {
        if (searchable && event.key === 'ArrowUp' && event.target === event.currentTarget.querySelector('[role="menuitemcheckbox"]')) {
          event.preventDefault()
          event.stopPropagation()
          searchRef.current?.focus()
        }
      }}>
        <div className="filter-select-heading">Match any</div>
        {searchable && <input ref={searchRef} className="filter-select-search" type="search" aria-label={searchLabel} placeholder={`${searchLabel}…`} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') return
          event.stopPropagation()
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')
            const item = event.key === 'ArrowDown' ? items?.[0] : items?.[items.length - 1]
            item?.focus()
          } else if (event.key === 'Tab') {
            event.preventDefault()
            setOpen(false)
          }
        }} />}
        <div className="filter-select-options">
          {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={selected.includes(option.value)} onSelect={event => event.preventDefault()} onCheckedChange={() => onToggle(option.value)}>
            <span className="filter-option-name">{option.label}</span><span className="filter-count" aria-hidden="true">{counts[option.value]}</span>
          </DropdownMenuCheckboxItem>)}
          {!matches.length && <p className="filter-select-empty" role="status">{term ? 'No matches.' : 'No options.'}</p>}
        </div>
        <DropdownMenuItem className="filter-select-clear" disabled={!selected.length} onSelect={event => { event.preventDefault(); setQuery(''); onClear(); searchRef.current?.focus() }}><X size={14} />Clear {group.label.toLowerCase()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
