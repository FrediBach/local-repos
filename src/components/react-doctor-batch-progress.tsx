import { Check, LoaderCircle, Stethoscope } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { ReactDoctorBatchProgress as Progress } from '../hooks/use-react-doctor-batch'

const progressTitles: Record<Progress['status'], string> = {
  running: 'Running React Doctor',
  stopping: 'Running React Doctor',
  stopped: 'React Doctor scan stopped',
  completed: 'React Doctor scan complete',
}

export function ReactDoctorBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  return <section className="capture-progress-panel" aria-label="Workspace React Doctor scan">
    <BatchProgressHeader progress={progress} title={progressTitles[progress.status]}
      icon={<ReactDoctorProgressIcon progress={progress} />} action="Scanning" dismissLabel="Dismiss React Doctor progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="React Doctor scan progress" action="scanning" />
    <ReactDoctorScanSummary progress={progress} />
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Previous React Doctor results are kept when a scan fails.</BatchFailures>
  </section>
}

function ReactDoctorProgressIcon({ progress }: { progress: Progress }) {
  if (progress.status === 'running' || progress.status === 'stopping') return <LoaderCircle size={17} className="spinning" />
  if (progress.status === 'completed' && !progress.failures.length && !progress.findings && !progress.limited) return <Check size={17} />
  return <Stethoscope size={17} />
}

function ReactDoctorScanSummary({ progress }: { progress: Progress }) {
  const average = progress.scored ? Math.round(progress.scoreTotal / progress.scored * 10) / 10 : undefined
  return <>
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} React projects processed</span><span>{progress.succeeded} scanned</span><span>{progress.findings} findings across {progress.withFindings} {progress.withFindings === 1 ? 'project' : 'projects'}</span><span>{average === undefined ? 'No scores available' : `${average}/100 average score`}</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    {progress.scored > 0 && <p className="capture-progress-note">Average uses {progress.scored} available {progress.scored === 1 ? 'score' : 'scores'} from this scan. Higher scores indicate better React health.</p>}
    {progress.limited > 0 && <p className="capture-cache-warning">{progress.limited} {progress.limited === 1 ? 'project has' : 'projects have'} limited results. Open the project’s React Doctor tab for details; missing scores are excluded from the average.</p>}
  </>
}
