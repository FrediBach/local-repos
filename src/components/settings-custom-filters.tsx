import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Filter, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { customFilterNameLimit, validCustomFilterName, type CustomFilter } from '@/lib/project-filter-state'

export function SettingsCustomFilters({ filters, submitted, onChange }: { filters: CustomFilter[]; submitted: boolean; onChange: (filters: CustomFilter[]) => void }) {
  const id = useId()
  const list = useRef<HTMLOListElement>(null)
  const [message, setMessage] = useState('')
  function focusRow(index: number) {
    requestAnimationFrame(() => ((list.current?.children[index] as HTMLElement | undefined) ?? list.current)?.focus())
  }
  function move(index: number, offset: number) {
    const next = [...filters]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    next.splice(target, 0, next.splice(index, 1)[0])
    onChange(next)
    setMessage(`Moved ${filters[index].name} to position ${target + 1}.`)
    focusRow(target)
  }

  return <fieldset className="settings-section"><legend>Custom filters</legend>
    <p>Use Save filter above the project list to add a named sidebar shortcut. Rename, reorder, or remove filters here, then save settings.</p>
    <ol className="settings-custom-filters" ref={list} tabIndex={-1} aria-label="Custom filters in sidebar order">
      {filters.map((filter, index) => <li key={filter.id} tabIndex={-1}>
        <Filter size={17} aria-hidden="true" />
        <div className="settings-field custom-filter-name"><label className="sr-only" htmlFor={`${id}-${index}-name`}>Filter name {index + 1}</label>
          <input id={`${id}-${index}-name`} value={filter.name} maxLength={customFilterNameLimit} required autoComplete="off"
            aria-invalid={submitted && !validCustomFilterName(filter.name)} aria-describedby={submitted && !validCustomFilterName(filter.name) ? `${id}-${index}-error` : undefined}
            onChange={event => onChange(filters.map(item => item.id === filter.id ? { ...item, name: event.target.value } : item))} />
          {submitted && !validCustomFilterName(filter.name) && <small id={`${id}-${index}-error`} className="settings-field-error">Enter a filter name of 1–{customFilterNameLimit} characters.</small>}
        </div>
        <div className="custom-filter-actions">
          <Button type="button" variant="ghost" size="icon" aria-label={`Move ${filter.name} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Move ${filter.name} down`} disabled={index === filters.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${filter.name}`} onClick={() => {
            onChange(filters.filter(item => item.id !== filter.id))
            setMessage(`Removed ${filter.name}.`)
            focusRow(Math.max(0, Math.min(index, filters.length - 2)))
          }}><Trash2 size={16} /></Button>
        </div>
      </li>)}
    </ol>
    {!filters.length && <p>No custom filters yet. Choose your filters and select Save filter to get started.</p>}
    <span className="sr-only" role="status">{message}</span>
  </fieldset>
}
