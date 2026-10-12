import { ArrowDownWideNarrow, ChevronDown } from 'lucide-react'

export function SortControl<Value extends string>({ label, value, onChange, options }: {
  label: string
  value: Value
  onChange: (value: Value) => void
  options: readonly { value: Value; label: string }[]
}) {
  return <label className="sort-control"><ArrowDownWideNarrow size={15} aria-hidden="true" /><select value={value} onChange={event => onChange(event.target.value as Value)} aria-label={label}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} aria-hidden="true" /></label>
}
