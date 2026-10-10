import { Check, LoaderCircle, ShieldAlert } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { AuditBatchProgress as Progress } from '../hooks/use-audit-batch'

export function AuditBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  return <section className="capture-progress-panel" aria-label="Workspace vulnerability scan">
    <BatchProgressHeader progress={progress} title={active ? 'Scanning vulnerabilities' : progress.status === 'stopped' ? 'Vulnerability scan stopped' : 'Vulnerability scan complete'}
      icon={active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length && !progress.vulnerable ? <Check size={17} /> : <ShieldAlert size={17} />} action="Scanning" dismissLabel="Dismiss audit progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Vulnerability scan progress" action="scanning" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} processed</span><span>{progress.succeeded} scanned</span><span className={progress.vulnerable ? 'capture-failure-count' : ''}>{progress.vulnerable} vulnerable</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    <p className="capture-progress-note">Package names and versions are sent to each project’s configured registry.</p>
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Previous vulnerability results are kept when a scan fails.</BatchFailures>
  </section>
}
