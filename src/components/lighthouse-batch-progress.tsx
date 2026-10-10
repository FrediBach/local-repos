import { Check, Gauge, LoaderCircle } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { LighthouseBatchProgress as Progress } from '../hooks/use-lighthouse-batch'

const progressTitles: Record<Progress['status'], string> = { running: 'Running Lighthouse', stopping: 'Running Lighthouse', stopped: 'Lighthouse scan stopped', completed: 'Lighthouse scan complete' }

export function LighthouseBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const active = progress.status === 'running' || progress.status === 'stopping'
  const average = progress.scored ? Math.round(progress.scoreTotal / progress.scored * 10) / 10 : undefined
  return <section className="capture-progress-panel" aria-label="Workspace Lighthouse scan">
    <BatchProgressHeader progress={progress} title={progressTitles[progress.status]} icon={active ? <LoaderCircle size={17} className="spinning" /> : progress.status === 'completed' && !progress.failures.length && !progress.findings && !progress.limited ? <Check size={17} /> : <Gauge size={17} />} action="Scanning" dismissLabel="Dismiss Lighthouse progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Lighthouse scan progress" action="scanning" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} frontend projects processed</span><span>{progress.succeeded} scanned</span><span>{progress.findings} audits need attention across {progress.withFindings} {progress.withFindings === 1 ? 'project' : 'projects'}</span><span>{average === undefined ? 'No performance scores available' : `${average}/100 average performance score`}</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    {progress.scored > 0 && <p className="capture-progress-note">Average uses {progress.scored} available performance {progress.scored === 1 ? 'score' : 'scores'} from this scan. Open each Lighthouse tab for all four category scores.</p>}
    {progress.limited > 0 && <p className="capture-cache-warning">{progress.limited} {progress.limited === 1 ? 'project has' : 'projects have'} limited results. Open the project’s Lighthouse tab for details; missing performance scores are excluded from the average.</p>}
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Previous Lighthouse results are kept when a scan fails.</BatchFailures>
  </section>
}
