import { Check, LoaderCircle, Package } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import { configureOutdatedReport, formatOutdatedScore, sumOutdatedScore } from '../lib/outdated'
import { useSettings } from '../hooks/use-settings'
import type { OutdatedBatchProgress as Progress } from '../hooks/use-outdated-batch'

export function OutdatedBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const { settings } = useSettings()
  const score = progress.reports?.length === progress.succeeded ? sumOutdatedScore(progress.reports.map(report => configureOutdatedReport(report, settings))) : progress.score
  const active = progress.status === 'running' || progress.status === 'stopping'
  return <section className="capture-progress-panel" aria-label="Workspace outdated-package scan">
    <BatchProgressHeader progress={progress} title={active ? 'Scanning outdated packages' : progress.status === 'stopped' ? 'Outdated-package scan stopped' : 'Outdated-package scan complete'}
      icon={active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length && !progress.outdated && !progress.skipped ? <Check size={17} /> : <Package size={17} />} action="Scanning" dismissLabel="Dismiss outdated scan progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Outdated-package scan progress" action="scanning" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} processed</span><span>{progress.succeeded} scanned</span><span>{progress.outdated} with outdated packages</span><span>{formatOutdatedScore(score)} total lag points</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    <p className="capture-cache-warning">Total lag points sum successful results from this scan. Package registries are contacted; no packages are changed.</p>
    {progress.skipped > 0 && <p className="capture-cache-warning">{progress.skipped} {progress.skipped === 1 ? 'package was' : 'packages were'} skipped. Open the project’s Packages tab for details; the score covers compared versions only.</p>}
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Previous outdated-package results are kept when a scan fails.</BatchFailures>
  </section>
}
