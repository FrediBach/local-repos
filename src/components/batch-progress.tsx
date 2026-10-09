import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/button'
import type { PreviewBatchProgress } from '../hooks/use-preview-batch'

type Progress = Pick<PreviewBatchProgress, 'status' | 'completed' | 'total' | 'current'>

export function BatchProgressHeader({ progress, title, icon, action, dismissLabel, onStop, onDismiss }: {
  progress: Progress; title: string; icon: ReactNode; action: string; dismissLabel: string; onStop: () => void; onDismiss: () => void
}) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  return <div className="capture-progress-header">
    <div className="capture-progress-title">{icon}
      <div role="status" aria-live="polite"><strong>{title}</strong>
        {progress.current && <p>{progress.status === 'stopping' ? 'Stopping after' : action} <b>{progress.current.name}</b> ({progress.completed + 1} of {progress.total})</p>}
      </div>
    </div>
    {active ? <Button size="sm" variant="ghost" onClick={onStop} disabled={progress.status === 'stopping'}>{progress.status === 'stopping' ? 'Stopping…' : 'Stop after current'}</Button> : <button className="capture-progress-dismiss" onClick={onDismiss} aria-label={dismissLabel}><X size={16} /></button>}
  </div>
}

export function BatchProgressTrack({ progress, label, action }: { progress: Progress; label: string; action: string }) {
  const percent = progress.total ? progress.completed / progress.total * 100 : 0
  return <div className="capture-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of ${progress.total} processed${progress.current ? `; ${action} ${progress.current.name}` : ''}`}><span style={{ width: `${percent}%` }} /></div>
}

export function BatchCacheWarning({ count, kind = 'result' }: { count: number; kind?: 'result' | 'preview' }) {
  if (!count) return null
  return <p className="capture-cache-warning">{count} {kind}{count === 1 ? '' : 's'} could not be saved in browser storage. The {kind === 'preview' ? 'images' : 'results'} are available for this session.</p>
}

export function BatchFailures({ failures, operation = 'scan', children }: {
  failures: PreviewBatchProgress['failures']; operation?: 'scan' | 'capture'; children: ReactNode
}) {
  if (!failures.length) return null
  return <details className="capture-failures"><summary>{failures.length} {operation}{failures.length === 1 ? '' : 's'} failed — view details</summary><ul>{failures.map(failure => <li key={failure.id}><strong>{failure.name}</strong><span>{failure.message}</span></li>)}</ul><p>{children}</p></details>
}
