import { useRef, useState } from 'react'
import { Check, LoaderCircle, Plus, Tag, X } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { normalizeTag, normalizeTags, suggestedTags, tagNameLimit } from '@/lib/project-tags'
import type { RepoProject } from '@/types'
import './project-tags.css'

export function ProjectTagChips({ project, active = [], ready, onFilter, onEdit }: {
  project: RepoProject; active?: string[]; ready: boolean; onFilter: (tag: string) => void; onEdit: () => void
}) {
  const tags = project.tags ?? []
  return <>
    {tags.slice(0, 3).map(tag => <button type="button" className="user-project-tag" key={tag} title={`Filter by tag: ${tag}`} aria-label={`Filter by tag: ${tag}`} aria-pressed={active.includes(`tag:${tag}`)} onClick={() => onFilter(tag)}><Tag size={12} aria-hidden="true" /><span>{tag}</span></button>)}
    <button type="button" className="edit-project-tags" disabled={!ready} aria-label={`${tags.length ? 'Edit' : 'Add'} tags for ${project.name}`} title={tags.length ? 'Edit tags' : 'Add tags'} onClick={onEdit}><Plus size={12} aria-hidden="true" />{tags.length > 3 ? `${tags.length - 3} more` : !tags.length ? 'Add tags' : <span className="sr-only">Edit tags</span>}</button>
  </>
}

export function ProjectTagDialog({ project, availableTags, onSave, onClose, returnFocus }: {
  project: RepoProject; availableTags: string[]; onSave: (tags: string[]) => Promise<void>; onClose: () => void; returnFocus: () => void
}) {
  const [draft, setDraft] = useState(project.tags ?? [])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const name = normalizeTag(input)
  const assignedTags = new Set(draft)
  const choices = normalizeTags([...suggestedTags, ...availableTags]).filter(tag => !assignedTags.has(tag) && (!name || tag.includes(name)))

  function add(tag: string) {
    if (!normalizeTags([tag]).length) { setError(`Use a tag of 1–${tagNameLimit} characters, without control characters.`); return }
    setDraft(current => normalizeTags([...current, tag])); setInput(''); setError(''); inputRef.current?.focus()
  }

  async function save() {
    // Include an unfinished entry so clicking Save never silently drops a tag.
    if (name && !normalizeTags([name]).length) { setError(`Use a tag of 1–${tagNameLimit} characters, without control characters.`); inputRef.current?.focus(); return }
    setSaving(true); setError('')
    try { await onSave(normalizeTags([...draft, ...(name ? [name] : [])])); onClose() }
    catch { setError('Could not save tags in this browser. Your changes are still here; try saving again.') }
    finally { setSaving(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent className="tag-dialog" onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus() }}>
    <span className="eyebrow"><Tag size={14} /> ORGANIZE YOUR PROJECTS</span>
    <DialogTitle>Tags for {project.name}</DialogTitle>
    <DialogDescription>Group projects your way. Click a tag on a project to filter your workspace.</DialogDescription>
    <form onSubmit={event => { event.preventDefault(); if (!saving) { if (name) add(name); else void save() } }}>
      <fieldset disabled={saving} className="tag-editor-fields">
        <div className="tag-editor-selected" aria-label="Assigned tags">
          {draft.length ? draft.map(tag => <button type="button" key={tag} aria-label={`Remove tag ${tag}`} onClick={() => setDraft(current => current.filter(value => value !== tag))}><Tag size={13} /><span>{tag}</span><X size={13} /></button>) : <p>No tags yet. Choose a suggestion or add your own.</p>}
        </div>
        <label htmlFor="project-tag-input" className="input-label">Add a tag</label>
        <div className="tag-editor-input"><input ref={inputRef} id="project-tag-input" value={input} onChange={event => { setInput(event.target.value); setError('') }} placeholder="e.g. work, private, contributing" autoComplete="off" aria-describedby="project-tag-hint" aria-invalid={!!error || name.length > tagNameLimit} /><Button variant="outline" type="submit" disabled={!name || name.length > tagNameLimit}><Plus size={15} />Add</Button></div>
        <p id="project-tag-hint" className="field-hint">One tag at a time. Press Enter to add. Up to {tagNameLimit} characters.{name.length > tagNameLimit && ` Current tag: ${name.length} characters.`}</p>
        {!!choices.length && <div className="tag-editor-suggestions"><span>Suggestions</span><div>{choices.map(tag => <button type="button" key={tag} onClick={() => add(tag)}><Plus size={12} /><span>{tag}</span></button>)}</div></div>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="tag-editor-footer"><Button variant="ghost" type="button" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving || name.length > tagNameLimit} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{saving ? 'Saving…' : 'Save tags'}</Button></div>
    </form>
    <p className="tag-editor-privacy">Saved in this browser, including after rescans.</p>
  </DialogContent></Dialog>
}
