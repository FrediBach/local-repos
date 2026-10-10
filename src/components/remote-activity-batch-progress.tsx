import { GitPullRequest, LoaderCircle } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { RemoteActivityBatchProgress as Progress } from '../hooks/use-remote-activity-batch'

export function RemoteActivityBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  return <section className="capture-progress-panel" aria-label="Workspace issues and pull requests scan">
    <BatchProgressHeader progress={progress} title={active ? 'Checking issues and pull requests' : progress.status === 'stopped' ? 'Repository checks stopped' : 'Repository checks complete'} icon={active ? <LoaderCircle size={17} className="spinning" /> : <GitPullRequest size={17} />} action="Checking" dismissLabel="Dismiss repository check progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Repository check progress" action="checking" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} repositories processed</span><span>{progress.succeeded} checked</span><span>{progress.withNewItems} with newly open items</span><span>{progress.failures.length} unavailable or failed</span></div>
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Last successful counts are kept when a repository is inaccessible or a check fails.</BatchFailures>
  </section>
}
