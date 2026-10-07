import { Check, LoaderCircle, ShieldAlert, X } from 'lucide-react'
import { Button } from './ui/button'
import type { AuditBatchProgress as Progress } from '../hooks/use-audit-batch'

export function AuditBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  const percent = progress.total ? progress.completed / progress.total * 100 : 0
  return <section className="capture-progress-panel" aria-label="Workspace vulnerability scan">
    <div className="capture-progress-header">
      <div className="capture-progress-title">{active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length && !progress.vulnerable ? <Check size={17} /> : <ShieldAlert size={17} />}
        <div role="status" aria-live="polite"><strong>{active ? 'Scanning vulnerabilities' : progress.status === 'stopped' ? 'Vulnerability scan stopped' : 'Vulnerability scan complete'}</strong>
          {progress.current && <p>{progress.status === 'stopping' ? 'Stopping after' : 'Scanning'} <b>{progress.current.name}</b> ({progress.completed + 1} of {progress.total})</p>}
        </div>
      </div>
      {active ? <Button size="sm" variant="ghost" onClick={onStop} disabled={progress.status === 'stopping'}>{progress.status === 'stopping' ? 'Stopping…' : 'Stop after current'}</Button> : <button className="capture-progress-dismiss" onClick={onDismiss} aria-label="Dismiss audit progress"><X size={16} /></button>}
    </div>
    <div className="capture-progress-track" role="progressbar" aria-label="Vulnerability scan progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of ${progress.total} processed${progress.current ? `; scanning ${progress.current.name}` : ''}`}><span style={{ width: `${percent}%` }} /></div>
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} processed</span><span>{progress.succeeded} scanned</span><span className={progress.vulnerable ? 'capture-failure-count' : ''}>{progress.vulnerable} vulnerable</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    <p className="capture-cache-warning">Package names and versions are sent to each project’s configured registry.</p>
    {progress.cacheWarnings > 0 && <p className="capture-cache-warning">{progress.cacheWarnings} {progress.cacheWarnings === 1 ? 'result could' : 'results could'} not be saved in browser storage. The results are available for this session.</p>}
    {progress.failures.length > 0 && <details className="capture-failures"><summary>{progress.failures.length} {progress.failures.length === 1 ? 'scan failed' : 'scans failed'} — view details</summary><ul>{progress.failures.map(failure => <li key={failure.id}><strong>{failure.name}</strong><span>{failure.message}</span></li>)}</ul><p>Previous vulnerability results are kept when a scan fails.</p></details>}
  </section>
}
