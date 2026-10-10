import { useEffect, useRef, useState } from 'react'
import type { ScanProgress, ScanProgressReporter } from '@/types'

export interface ActiveScanProgress {
  title: string
  projectId?: string
  projectName?: string
  stage: ScanProgress
  stageStartedAt: number
  startedAt: number
}

/** Keep late progress from a finished request or an old workspace out of the UI. */
export function useScanProgress() {
  const [progress, setProgress] = useState<ActiveScanProgress>()
  const mounted = useRef(true)
  const active = useRef<object | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; active.current = undefined }
  }, [])

  function begin(title: string, isCurrent: () => boolean, project?: { id: string; name: string }) {
    const job = {}
    active.current = job
    const now = Date.now()
    let state: ActiveScanProgress = { title, projectId: project?.id, projectName: project?.name, stage: { phase: 'Preparing scan' }, stageStartedAt: now, startedAt: now }
    const current = () => mounted.current && active.current === job && isCurrent()
    if (current()) setProgress(state)
    const report: ScanProgressReporter = stage => {
      if (!current()) return
      state = { ...state, stage, stageStartedAt: stage.phase === state.stage.phase ? state.stageStartedAt : Date.now() }
      setProgress(state)
    }
    return {
      report,
      finish: () => {
        if (active.current !== job) return
        active.current = undefined
        if (mounted.current) setProgress(undefined)
      },
    }
  }

  return { progress, begin }
}
