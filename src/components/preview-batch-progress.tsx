import { Check, LoaderCircle, Monitor, X } from 'lucide-react'
import { Button } from './ui/button'
import type { PreviewBatchProgress as Progress } from '../hooks/use-preview-batch'

export function PreviewBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  const percent = progress.total ? progress.completed / progress.total * 100 : 0
  return <section className="capture-progress-panel" aria-label="Batch preview capture">
    <div className="capture-progress-header">
      <div className="capture-progress-title">{active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length ? <Check size={17} /> : <Monitor size={17} />}
        <div role="status" aria-live="polite"><strong>{active ? 'Capturing previews' : progress.status === 'stopped' ? 'Preview capture stopped' : 'Preview capture complete'}</strong>
          {progress.current && <p>{progress.status === 'stopping' ? 'Stopping after' : 'Capturing'} <b>{progress.current.name}</b> ({progress.completed + 1} of {progress.total})</p>}
        </div>
      </div>
      {active ? <Button size="sm" variant="ghost" onClick={onStop} disabled={progress.status === 'stopping'}>{progress.status === 'stopping' ? 'Stopping…' : 'Stop after current'}</Button> : <button className="capture-progress-dismiss" onClick={onDismiss} aria-label="Dismiss capture progress"><X size={16} /></button>}
    </div>
    <div className="capture-progress-track" role="progressbar" aria-label="Preview capture progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of ${progress.total} processed${progress.current ? `; capturing ${progress.current.name}` : ''}`}><span style={{ width: `${percent}%` }} /></div>
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} processed</span><span>{progress.succeeded} captured</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    {progress.cacheWarnings > 0 && <p className="capture-cache-warning">{progress.cacheWarnings} {progress.cacheWarnings === 1 ? 'preview could' : 'previews could'} not be saved in browser storage. The images are available for this session.</p>}
    {progress.failures.length > 0 && <details className="capture-failures"><summary>{progress.failures.length} {progress.failures.length === 1 ? 'capture failed' : 'captures failed'} — view details</summary><ul>{progress.failures.map(failure => <li key={failure.id}><strong>{failure.name}</strong><span>{failure.message}</span></li>)}</ul><p>Previous previews are kept when a capture fails.</p></details>}
  </section>
}
