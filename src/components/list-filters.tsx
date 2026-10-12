import { useId, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import './project-filters.css'

export function FilterMultiSelect({ group, selected, counts, onToggle, onClear, searchLabel }: {
  group: { label: string; options: { value: string; label: string }[] }; selected: string[]; counts: Record<string, number>; onToggle: (value: string) => void; onClear: () => void; searchLabel?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchable = group.options.length > 8
  const term = searchable ? query.trim().toLowerCase() : ''
  const matches = group.options.filter(option => option.label.toLowerCase().includes(term))
  const matchingOptions = new Set(matches)
  const selectedValues = new Set(selected)
  const options = group.options.filter(option => matchingOptions.has(option) || selectedValues.has(option.value))
  const summary = group.options.filter(option => selectedValues.has(option.value)).map(option => option.label).join(', ') || 'Any'
  const inputLabel = searchLabel ?? `Find ${group.label.toLowerCase()}`

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
        {searchable && <input ref={searchRef} className="filter-select-search" type="search" aria-label={inputLabel} placeholder={`${inputLabel}…`} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
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
          {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={selectedValues.has(option.value)} onSelect={event => event.preventDefault()} onCheckedChange={() => onToggle(option.value)}>
            <span className="filter-option-name">{option.label}</span><span className="filter-count" aria-hidden="true">{counts[option.value] ?? 0}</span>
          </DropdownMenuCheckboxItem>)}
          {!matches.length && <p className="filter-select-empty" role="status">{term ? 'No matches.' : 'No options.'}</p>}
        </div>
        <DropdownMenuItem className="filter-select-clear" disabled={!selected.length} onSelect={event => { event.preventDefault(); setQuery(''); onClear(); searchRef.current?.focus() }}><X size={14} />Clear {group.label.toLowerCase()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}


export function ActiveListFilters({ active, query, searchLabel = 'Search', summary, onClear, onClearSearch }: {
  active: { id: string; label: string; onRemove: () => void }[]
  query: string
  searchLabel?: string
  summary: string
  onClear: () => void
  onClearSearch: () => void
}) {
  if (!active.length && !query.trim()) return null
  return <div className="active-project-filters">
    <div className="filter-summary"><span aria-live="polite">{summary}</span><button type="button" onClick={onClear}>Clear filters <X size={12} /></button></div>
    <div className="filter-chips" aria-label="Active filters">
      {query.trim() && <button type="button" className="filter-chip" aria-label="Remove search filter" onClick={onClearSearch}><span>{searchLabel}: {query.trim()}</span><X size={12} /></button>}
      {active.map(item => <button type="button" className="filter-chip" key={item.id} aria-label={`Remove ${item.label}`} onClick={item.onRemove}><span>{item.label}</span><X size={12} /></button>)}
    </div>
  </div>
}
