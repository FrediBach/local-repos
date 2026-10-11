import { useId, useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'
import { customFilterNameLimit } from '@/lib/project-filter-state'

export function SaveFilterDialog({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const id = useId()

  return <Dialog open={open} onOpenChange={value => { setOpen(value); setName(''); setError('') }}>
    <DialogTrigger asChild><button type="button" className="filter-shortcut"><Filter size={14} aria-hidden="true" />Save filter</button></DialogTrigger>
    <DialogContent className="save-filter-dialog">
      <DialogTitle>Save custom filter</DialogTitle>
      <DialogDescription>Save the current filters, search, and sort order as a shortcut in the sidebar.</DialogDescription>
      <form onSubmit={event => {
        event.preventDefault()
        try { onSave(name); setOpen(false) }
        catch (error) { setError(error instanceof Error ? error.message : 'Could not save this filter.') }
      }}>
        <label className="filter-field" htmlFor={id}>Filter name
          <input id={id} value={name} maxLength={customFilterNameLimit} required autoComplete="off" placeholder="e.g. React projects to update"
            onChange={event => { setName(event.target.value); setError('') }} />
        </label>
        {error && <p role="alert" className="save-filter-error">{error}</p>}
        <div className="save-filter-actions"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim()}>Save filter</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
