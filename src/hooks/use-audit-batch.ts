import { useEffect, useRef, useState } from 'react'
import type { RepoProject, ScanProgress, ScanProgressReporter } from '../types'

export interface AuditBatchProgress {
  status: 'running' | 'stopping' | 'completed' | 'stopped'
  stage?: ScanProgress
  stageStartedAt?: number
  startedAt?: number
  total: number
  completed: number
  succeeded: number
  vulnerable: number
  current?: Pick<RepoProject, 'id' | 'name'>
  failures: { id: string; name: string; message: string }[]
  cacheWarnings: number
}

type Audit = (project: RepoProject, isCurrent: () => boolean, reportProgress: ScanProgressReporter) => Promise<{ cacheWarning?: boolean; vulnerable?: boolean } | void>

/** Audit every queued project sequentially and stop only after the active request. */
export function useAuditBatch() {
  const [progress, setProgress] = useState<AuditBatchProgress>()
  const mounted = useRef(true)
  const active = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) active.current.stop = true
    }
  }, [])

  async function run(projects: RepoProject[], audit: Audit, isWorkspaceCurrent: () => boolean = () => true) {
    if (!mounted.current || active.current || !isWorkspaceCurrent() || !projects.length) return
    const job = { stop: false }
    active.current = job
    const queue = [...projects]
    let state: AuditBatchProgress = { status: 'running', startedAt: Date.now(), total: queue.length, completed: 0, succeeded: 0, vulnerable: 0, failures: [], cacheWarnings: 0 }
    const isCurrent = () => mounted.current && active.current === job && isWorkspaceCurrent()
    const publish = () => {
      if (isCurrent()) setProgress({ ...state, status: job.stop && state.status === 'running' ? 'stopping' : state.status })
    }

    try {
      for (const project of queue) {
        if (job.stop || !isCurrent()) break
        state = { ...state, current: { id: project.id, name: project.name }, stage: { phase: 'Preparing scan' }, stageStartedAt: Date.now() }
        const reportProgress: ScanProgressReporter = stage => {
          if (!isCurrent() || state.current?.id !== project.id) return
          state = { ...state, stage, stageStartedAt: stage.phase === state.stage?.phase ? state.stageStartedAt : Date.now() }
          publish()
        }
        publish()
        try {
          const result = await audit(project, isCurrent, reportProgress)
          if (!isCurrent()) break
          state = {
            ...state,
            succeeded: state.succeeded + 1,
            vulnerable: state.vulnerable + (result?.vulnerable ? 1 : 0),
            // A successful save stores the whole workspace, including earlier results.
            cacheWarnings: result?.cacheWarning ? state.cacheWarnings + 1 : 0,
          }
        } catch (error) {
          state = { ...state, failures: [...state.failures, { id: project.id, name: project.name, message: error instanceof Error ? error.message : 'The vulnerability scan could not be completed.' }] }
        }
        state = { ...state, completed: state.completed + 1 }
        publish()
      }
    } finally {
      state = { ...state, current: undefined, stage: undefined, stageStartedAt: undefined, status: state.completed === state.total ? 'completed' : 'stopped' }
      publish()
      if (active.current === job) {
        active.current = null
        if (mounted.current && !isWorkspaceCurrent()) setProgress(undefined)
      }
    }
    return state
  }

  function stop() {
    if (!mounted.current || !active.current) return
    active.current.stop = true
    setProgress(current => current && ({ ...current, status: 'stopping' }))
  }

  return {
    progress, run, stop,
    isActive: () => active.current !== null,
    dismiss: () => { if (mounted.current && !active.current) setProgress(undefined) },
  }
}
