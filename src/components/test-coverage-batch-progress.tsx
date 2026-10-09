import { FlaskConical, LoaderCircle } from 'lucide-react'
import { BatchCacheWarning, BatchFailures, BatchProgressHeader, BatchProgressTrack } from './batch-progress'
import type { TestCoverageBatchProgress as Progress } from '../hooks/use-test-coverage-batch'

const titles: Record<Progress['status'], string> = {
  running: 'Scanning test coverage', stopping: 'Scanning test coverage',
  stopped: 'Coverage scan stopped', completed: 'Coverage scan complete',
}

export function TestCoverageBatchProgress({ progress, onStop, onDismiss }: { progress: Progress; onStop: () => void; onDismiss: () => void }) {
  const running = progress.status === 'running' || progress.status === 'stopping'
  return <section className="capture-progress-panel" aria-label="Workspace coverage scan">
    <BatchProgressHeader progress={progress} title={titles[progress.status]}
      icon={running ? <LoaderCircle size={17} className="spinning" /> : <FlaskConical size={17} />}
      action="Scanning" dismissLabel="Dismiss coverage progress" onStop={onStop} onDismiss={onDismiss} />
    <BatchProgressTrack progress={progress} label="Coverage scan progress" action="scanning" />
    <div className="capture-progress-counts"><span>{progress.completed} of {progress.total} projects processed</span><span>{progress.succeeded - progress.imported} test runs</span><span>{progress.imported} saved reports</span><span>{progress.measured} with line coverage</span><span className={progress.failures.length ? 'capture-failure-count' : ''}>{progress.failures.length} failed</span></div>
    {progress.limited > 0 && <p className="capture-cache-warning">{progress.limited} {progress.limited === 1 ? 'project has' : 'projects have'} scan notes. Open the Coverage tab for scope, report age, and test failures.</p>}
    <BatchCacheWarning count={progress.cacheWarnings} />
    <BatchFailures failures={progress.failures}>Previous coverage results are kept when a scan fails.</BatchFailures>
  </section>
}
