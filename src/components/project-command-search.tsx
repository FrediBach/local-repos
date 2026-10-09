import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, Command, FolderOpen, Package, Search, SlidersHorizontal, Terminal, X } from 'lucide-react'
import { useSettings } from '@/hooks/use-settings'
import { commandTemplates, type ProjectCommand } from '@/lib/project-commands'
import type { FilterGroup, FilterKey } from '@/lib/project-filters'
import { createProjectSearchIndex, type SearchSelection, type SearchSuggestion, type WorkspaceCommandId } from '@/lib/project-search'
import type { RepoProject } from '@/types'
import './project-command-search.css'

export interface ProjectCommandSearchProps {
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  setQuery: (query: string) => void
  searchScope: 'all' | 'packages'
  setSearchScope: (scope: 'all' | 'packages') => void
  projects: RepoProject[]
  favorites: string[]
  filterGroups: FilterGroup[]
  helper: boolean
  busy: boolean
  tagsReady: boolean
  onCommand: (project: RepoProject, command: ProjectCommand) => void
  onWorkspaceCommand: (command: WorkspaceCommandId) => void
  onFilter: (key: FilterKey, value: string) => void
}

const pageSize = 40
const suggestionIcon = (suggestion: SearchSuggestion) => suggestion.group === 'Scripts' ? Terminal
  : suggestion.intent.kind === 'project' ? FolderOpen : suggestion.intent.kind === 'package' ? Package
    : suggestion.intent.kind === 'filter' ? SlidersHorizontal : Command

export function ProjectCommandSearch({ searchRef, query, setQuery, searchScope, setSearchScope, projects, favorites, filterGroups, helper, busy, tagsReady, onCommand, onWorkspaceCommand, onFilter }: ProjectCommandSearchProps) {
  const { settings } = useSettings()
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<SearchSelection>({})
  const [scopedQuery, setScopedQuery] = useState('')
  const [active, setActive] = useState(0)
  const [limit, setLimit] = useState(pageSize)
  const [placement, setPlacement] = useState({ above: false, height: 440 })
  const container = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const id = useId()
  const scoped = !!(selection.projectId || selection.templateId)
  const input = scoped ? scopedQuery : query
  const selectedProject = projects.find(project => project.id === selection.projectId)
  const selectedTemplate = commandTemplates(settings).find(template => template.id === selection.templateId)
  const scopeLabel = selectedProject?.name ?? selectedTemplate?.title
  const searchIndex = useMemo(() => createProjectSearchIndex({ projects, favorites, settings, filterGroups }), [projects, favorites, settings, filterGroups])
  const suggestions = useMemo(() => open ? searchIndex.search({ query: input, selection, packagesOnly: searchScope === 'packages' }) : [], [open, searchIndex, input, selection, searchScope])
  const visible = suggestions.slice(0, limit)
  const activeIndex = Math.min(active, visible.length - 1)
  const current = visible[activeIndex]

  useLayoutEffect(() => {
    if (!open) return
    function position() {
      const bounds = container.current?.getBoundingClientRect()
      if (!bounds) return
      const viewport = window.visualViewport
      const top = viewport?.offsetTop ?? 0
      const bottom = top + (viewport?.height ?? window.innerHeight)
      const below = bottom - bounds.bottom
      const above = below < 380 && bounds.top - top > below
      const height = Math.max(100, Math.min(440, (above ? bounds.top - top : below) - 180))
      setPlacement(current => current.above === above && current.height === height ? current : { above, height })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
    }
  }, [open, scoped])

  useEffect(() => {
    if (open) options.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open, input, selection])

  function changeInput(value: string) {
    if (scoped) setScopedQuery(value)
    else setQuery(value)
    setOpen(true); setActive(0); setLimit(pageSize)
  }

  function back() {
    setSelection({}); setScopedQuery(''); setActive(0); setLimit(pageSize); setOpen(true)
    searchRef.current?.focus()
  }

  function unavailable(suggestion: SearchSuggestion): string | undefined {
    if (suggestion.intent.kind === 'command') {
      if (suggestion.intent.command.intent.kind === 'tags' && !tagsReady) return 'Loading saved tags…'
      if (suggestion.helper && busy) return 'Wait for the current operation'
    }
    if (suggestion.intent.kind === 'workspace' && busy && ['resync', 'connect', 'audit-all', 'outdated-all', 'react-doctor-all', 'previews-all'].includes(suggestion.intent.name)) return 'Wait for the current operation'
    return undefined
  }

  function choose(suggestion: SearchSuggestion) {
    if (unavailable(suggestion)) return
    const intent = suggestion.intent
    if (intent.kind === 'project' || intent.kind === 'template') {
      setSelection(intent.kind === 'project' ? { projectId: intent.projectId } : { templateId: intent.templateId })
      setQuery(''); setScopedQuery(''); setActive(0); setLimit(pageSize); setOpen(true)
      searchRef.current?.focus()
      return
    }
    setOpen(false); setSelection({}); setScopedQuery(''); setActive(0); setLimit(pageSize)
    if (intent.kind === 'package') { setQuery(intent.query); return }
    setQuery('')
    if (intent.kind === 'command') {
      const project = projects.find(item => item.id === intent.projectId)
      if (project) onCommand(project, intent.command)
    } else if (intent.kind === 'workspace') onWorkspaceCommand(intent.name)
    else if (intent.kind === 'filter') onFilter(intent.key, intent.value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { setOpen(true); return }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      return
    }
    if (event.key === 'Backspace' && !input && scoped) { event.preventDefault(); back(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true)
      if (!open) { setActive(0); return }
      if (event.key === 'ArrowDown' && activeIndex === visible.length - 1 && suggestions.length > limit) setLimit(value => value + pageSize)
      setActive(event.key === 'ArrowDown' ? Math.max(0, Math.min(activeIndex + 1, suggestions.length - 1)) : Math.max(activeIndex - 1, 0))
    } else if (open && event.key === 'Enter' && current) {
      event.preventDefault(); choose(current)
    } else if (open && event.key === 'Tab' && !event.shiftKey && current && ['project', 'template', 'package'].includes(current.intent.kind)) {
      event.preventDefault(); choose(current)
    } else if (event.key === 'Tab') setOpen(false)
  }

  return <div className="search-group command-search" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <select className="search-scope" aria-label="Search scope" value={searchScope} onChange={event => {
      setSearchScope(event.target.value as 'all' | 'packages'); setSelection({}); setScopedQuery(''); setActive(0); setLimit(pageSize); setOpen(false)
    }}><option value="all">Projects & actions</option><option value="packages">Package name & version</option></select>
    <div className="search-box">
      <Search size={17} aria-hidden="true" />
      <input ref={searchRef} value={input} onChange={event => changeInput(event.target.value)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKeyDown}
        placeholder={searchScope === 'packages' ? 'Find a package or version…' : selectedProject ? 'Find an action or script…' : selectedTemplate ? 'Find a project or script…' : 'Search projects, actions, scripts…'}
        role="combobox" aria-label="Search projects" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-autocomplete="list" aria-haspopup="listbox"
        aria-activedescendant={open && current ? `${id}-option-${activeIndex}` : undefined} aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false} />
      {input ? <button aria-label="Clear search" onClick={() => { changeInput(''); searchRef.current?.focus() }}><X size={14} /></button> : <kbd aria-hidden="true">⌘ K</kbd>}
    </div>
    {scoped && <div className="command-scope"><button type="button" onClick={back} aria-label="Back to all commands"><ArrowLeft size={14} /><span>{scopeLabel ?? 'All commands'}</span><X size={12} /></button><span>{selectedProject ? selectedProject.relativePath : selectedTemplate?.id === 'scripts' ? 'Choose a script and project' : 'Choose a project'}</span></div>}
    <span id={`${id}-hint`} className="sr-only">Search projects, actions, scripts, tags, technologies, or packages. Arrow keys browse suggestions. Enter selects. Tab completes a project or action. Escape dismisses. Backspace in an empty search goes back.</span>
    {open && <div className={`command-popover${placement.above ? ' command-popover-above' : ''}`} style={{ '--command-height': `${placement.height}px` } as CSSProperties}>
      <div className="command-heading"><span>{scopeLabel ?? (searchScope === 'packages' ? 'Find a dependency' : input ? 'Search your workspace' : 'What would you like to do?')}</span><button type="button" aria-label="Close suggestions" onClick={() => setOpen(false)}><X size={15} /></button></div>
      {!scoped && !input && searchScope === 'all' && <div className="command-shortcuts" role="group" aria-label="Explore actions">
        {[['scripts', 'Run a script'], ['folder', 'Open folder'], ['tags', 'Add tags']].map(([templateId, title]) => <button key={templateId} type="button" onClick={() => choose({ id: templateId, title, description: '', group: 'Actions', intent: { kind: 'template', templateId } })}>{title}<ChevronRight size={12} /></button>)}
      </div>}
      <div className="command-options" id={`${id}-list`} role="listbox" aria-label="Search suggestions" ref={options}>
        {visible.map((suggestion, index) => {
          const Icon = suggestionIcon(suggestion)
          const disabled = unavailable(suggestion)
          const drill = suggestion.intent.kind === 'project' || suggestion.intent.kind === 'template'
          const needsHelper = suggestion.helper && !helper
          return <div key={suggestion.id} role="presentation">
            {(!index || visible[index - 1].group !== suggestion.group) && <div className="command-group" role="presentation">{suggestion.group}</div>}
            <div id={`${id}-option-${index}`} role="option" aria-selected={index === activeIndex} aria-disabled={!!disabled}
              className="command-option" onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(suggestion)}>
              <span className="command-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="command-copy"><strong>{suggestion.title}</strong><span>{suggestion.description}</span>{(disabled || needsHelper) && <small>{disabled ?? 'Connect the local helper to use this action'}</small>}</span>
              {drill ? <ChevronRight size={15} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
            </div>
          </div>
        })}
        {!visible.length && <div className="command-empty">No suggestions match{input ? ` “${input}”` : ' this selection'}.<span>{scoped ? 'Go back to choose another project or action.' : 'Try a project name, “run script”, “tags”, or “Finder”.'}</span></div>}
      </div>
      {suggestions.length > limit && <button type="button" className="command-more" onClick={() => setLimit(value => value + pageSize)}>Show more suggestions ({suggestions.length - limit})</button>}
      <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> browse <kbd>↵</kbd> select <kbd>Tab</kbd> complete</span><span><kbd>Esc</kbd> close</span></div>
      <span className="sr-only" role="status">{suggestions.length} suggestions{scopeLabel ? ` for ${scopeLabel}` : ''}</span>
    </div>}
  </div>
}
