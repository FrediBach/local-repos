import { useState } from 'react'
import { Check, Copy, Terminal } from 'lucide-react'
import { discoverProjectScripts, scriptCategories, scriptRunCommand, type ProjectScript } from '../lib/project-scripts'
import type { RepoProject } from '../types'
import { Button } from './ui/button'
import './project-scripts.css'

interface ProjectScriptsProps {
  project: RepoProject
  primaryScript?: string
  busy: string
  onAction: (action: string, body?: unknown) => void
}

export function ProjectScripts({ project, primaryScript, busy, onAction }: ProjectScriptsProps) {
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const scripts = discoverProjectScripts(project).filter(script => script.name !== primaryScript)
  if (!scripts.length) return null

  async function copy(script: ProjectScript) {
    try {
      await navigator.clipboard.writeText(scriptRunCommand(project.packageManager, script.name))
      setCopied(script.name)
      setCopyError('')
    } catch { setCopyError('Clipboard unavailable. Select and copy the command shown below.') }
  }

  function rows(items: ProjectScript[]) {
    return <ul className="project-script-list">{items.map(script => <li key={script.name}>
      <div className="project-script-command"><code>{scriptRunCommand(project.packageManager, script.name)}</code><span>{script.command}</span></div>
      <div className="project-script-actions">
        <Button variant="ghost" size="sm" aria-label={`Copy ${script.name} command`} title={copied === script.name ? 'Copied' : 'Copy command'} onClick={() => { void copy(script) }}>{copied === script.name ? <Check size={14} /> : <Copy size={14} />}</Button>
        <Button variant="outline" size="sm" disabled={!!busy} aria-label={`Run ${script.name} in terminal`} onClick={() => onAction('run-script', { name: script.name, command: script.command })}><Terminal size={14} />Run in terminal</Button>
      </div>
    </li>)}</ul>
  }

  return <section className="project-scripts" aria-label="Project scripts">
    <div className="dev-section-heading"><h3><Terminal size={16} />Project scripts</h3><span className="project-script-count">{scripts.length}</span></div>
    <p className="field-hint">Grouped by script name and command. Runs in your project folder; use the terminal for prompts, output, and stopping scripts.</p>
    {scriptCategories.map(([category, label]) => {
      const items = scripts.filter(script => script.category === category)
      if (!items.length) return null
      return category === 'other'
        ? <details className="project-script-group" key={category}><summary>{label} <span>{items.length}</span></summary>{rows(items)}</details>
        : <div className="project-script-group" key={category}><h4>{label}</h4>{rows(items)}</div>
    })}
    {copied && !copyError && <p className="field-hint" role="status">Copied {copied} command.</p>}
    {copyError && <p className="inline-error" role="status">{copyError}</p>}
  </section>
}
