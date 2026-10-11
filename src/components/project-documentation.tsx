import { useId, useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronUp, FileText, Folder } from 'lucide-react'
import type { RepoProject } from '@/types'
import { documentationTree, type DocumentationTree } from '@/lib/documentation'
import { ProjectReadme } from './project-readme'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

export function ProjectDocumentation({ project }: { project: RepoProject }) {
  const [selectedPath, setSelectedPath] = useState('')
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const tree = useMemo(() => documentationTree(project.documentation?.files ?? []), [project.documentation])
  const selected = project.documentation?.files.find(file => file.path === selectedPath)
  const path = selected?.path ?? ''
  const content = selected ? selected.content : project.readme
  const label = path || 'README'

  function select(path: string) {
    setSelectedPath(path)
    setExpanded(true)
  }

  return <section className="project-documentation" aria-label="Project documentation">
    <div className="documentation-heading">
      <h3><BookOpen size={16} /> {tree.length ? 'Documentation' : 'README'}</h3>
      {!!tree.length && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="documentation-picker" aria-label={`Choose documentation file: ${label}`}><FileText size={14} /><span>{label}</span><ChevronDown size={14} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="documentation-menu" aria-label="Documentation files">
          <DropdownMenuItem onSelect={() => select('')}><FileText size={14} /><span>README</span>{!path && <Check size={14} aria-label="Selected" />}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DocumentItems nodes={tree} selectedPath={path} onSelect={select} />
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    <div id={contentId}>
      {selected?.unavailable ? <p className="documentation-note">{selected.unavailable}</p>
        : <ProjectReadme content={content} preview={!expanded} emptyMessage={selected ? 'This document is empty.' : undefined} />}
    </div>
    {!!content?.trim() && <Button variant="ghost" size="sm" className="documentation-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{expanded ? 'Show less' : 'Read more'}
    </Button>}
    {!!project.documentation?.warnings.length && <p className="documentation-note">{project.documentation.warnings.join(' ')}</p>}
  </section>
}

function DocumentItems({ nodes, selectedPath, onSelect, depth = 0 }: { nodes: DocumentationTree[]; selectedPath: string; onSelect: (path: string) => void; depth?: number }) {
  return nodes.map(node => node.file
    ? <DropdownMenuItem key={node.path} style={{ paddingLeft: 10 + depth * 16 }} onSelect={() => onSelect(node.path)} title={node.path} aria-label={node.path}>
      <FileText size={14} /><span>{node.name}</span>{selectedPath === node.path && <Check size={14} aria-label="Selected" />}
    </DropdownMenuItem>
    : <div key={node.path} role="group" aria-label={node.path}>
      <div className="documentation-folder" style={{ paddingLeft: 10 + depth * 16 }}><Folder size={14} /><span>{node.name}</span></div>
      <DocumentItems nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
    </div>)
}
