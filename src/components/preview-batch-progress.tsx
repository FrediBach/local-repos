import { Check, LoaderCircle, Monitor } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { PreviewBatchProgress as Progress } from '../hooks/use-preview-batch'

export function PreviewBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  return <section className="capture-progress-panel" aria-label="Batch preview capture">
    <BatchProgressHeader progress={progress} title={active ? 'Capturing previews' : progress.status === 'stopped' ? 'Preview capture stopped' : 'Preview capture complete'}
      icon={active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length ? <Check size={17} /> : <Monitor size={17} />} action="Capturing" dismissLabel="Dismiss capture progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Preview capture progress" action="capturing" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} processed</span><span>{progress.succeeded} captured</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    <BatchCacheWarning count={progress.cacheWarnings} kind="preview" />
    <BatchFailures failures={progress.failures} operation="capture">Previous previews are kept when a capture fails.</BatchFailures>
  </section>
}
