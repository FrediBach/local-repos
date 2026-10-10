import { useEffect, useRef, useState } from 'react'
import { Clock3, LoaderCircle } from 'lucide-react'
import type { ActiveScanProgress } from '@/hooks/use-scan-progress'
import type { ScanProgress } from '@/types'

export function ScanElapsed({ since, label }: { since?: number; label: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [since])
  if (since === undefined) return null
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  return <span className="scan-elapsed" role="timer" aria-live="off"><Clock3 size={13} aria-hidden="true" />{duration} {label}</span>
}

export function ScanStage({ stage, stageStartedAt }: { stage?: ScanProgress; stageStartedAt?: number }) {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0
  }, [stage?.phase])
  return <div className="scan-stage">
    <div ref={content} className="scan-stage-content" role="region" aria-label="Current scan step" tabIndex={0} aria-live="polite" aria-atomic="true">
      <span className="scan-stage-label"><span className="status-dot" />Current step</span>
      <strong>{stage?.phase || 'Waiting for scan progress'}</strong>
      {stage?.detail && <p>{stage.detail}</p>}
      {stage?.completed !== undefined && <p className="scan-stage-count">{stage.completed.toLocaleString()}{stage.total !== undefined ? ` of ${stage.total.toLocaleString()}` : ''} processed in this step</p>}
    </div>
    <ScanElapsed since={stageStartedAt} label="in this step" />
  </div>
}

export function ScanProgressPanel({ progress }: { progress: ActiveScanProgress }) {
  return <section className="capture-progress-panel scan-progress-panel" aria-label={progress.title}>
    <div className="capture-progress-header">
      <div className="capture-progress-title">
        <span className="scan-progress-icon"><LoaderCircle size={17} className="spinning" aria-hidden="true" /></span>
        <div role="status"><strong>{progress.title}</strong>{progress.projectName && <p>{progress.projectName}</p>}</div>
      </div>
      <ScanElapsed since={progress.startedAt} label="elapsed" />
    </div>
    <ScanStage stage={progress.stage} stageStartedAt={progress.stageStartedAt} />
  </section>
}
