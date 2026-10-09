import { GitPullRequestArrow, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { Button } from './ui/button'
import type { PushReminderResult } from '@/lib/push-reminder'
import './push-reminder.css'

interface Props {
  results: PushReminderResult[]
  checking: boolean
  busy: boolean
  onRefresh: () => void
  onDismiss: () => void
  onOpen: (id: string) => void
}

export function PushReminder({ results, checking, busy, onRefresh, onDismiss, onOpen }: Props) {
  if (!results.length) return null
  return <section className="push-reminder" aria-label="End-of-day push reminder">
    <div className="push-reminder-heading"><div role="alert"><TriangleAlert size={19} /><strong>Before you wrap up, check your changes.</strong></div><button className="push-reminder-dismiss" onClick={onDismiss} aria-label="Dismiss push reminder for today" title="Dismiss for today"><X size={18} /></button></div>
    <p>Review these projects and push any work you want to keep on origin.</p>
    <ul>{results.map(({ project, status, error }) => <li key={project.id}>
      <button className="push-reminder-project" onClick={() => onOpen(project.id)} title={project.relativePath}><GitPullRequestArrow size={15} />{project.name}</button>
      <span>{error ? `Check unavailable: ${error}` : [
        status && status.unpushedCommits > 0 ? `${status.unpushedCommits} unpushed ${status.unpushedCommits === 1 ? 'commit' : 'commits'}` : '',
        status?.dirty ? 'Uncommitted changes — commit before pushing' : '',
        status && !status.originRefsKnown ? 'Origin status unknown — fetch origin, then recheck' : '',
        status?.shallow ? 'Shallow clone; history is limited' : '',
      ].filter(Boolean).join(' · ')}</span>
    </li>)}</ul>
    <div className="push-reminder-footer"><p>Based on locally known origin branches. Recheck after pushing; fetch origin first if its status may be out of date.</p><Button variant="outline" size="sm" disabled={checking || busy} onClick={onRefresh}><RefreshCw size={14} className={checking ? 'spinning' : ''} />{checking ? 'Checking…' : 'Recheck'}</Button></div>
  </section>
}
