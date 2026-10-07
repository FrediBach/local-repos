import { useEffect, useRef, useState } from 'react'
import type { RepoProject } from '../types'

export interface OutdatedBatchProgress {
  status: 'running' | 'stopping' | 'completed' | 'stopped'
  total: number
  completed: number
  succeeded: number
  outdated: number
  score: number
  skipped: number
  current?: Pick<RepoProject, 'id' | 'name'>
  failures: { id: string; name: string; message: string }[]
  cacheWarnings: number
}

type Scan = (project: RepoProject, isCurrent: () => boolean) => Promise<{ cacheWarning?: boolean; outdated?: boolean; score?: number; skipped?: number } | void>

/** Scan every queued project sequentially and stop only after the active request. */
export function useOutdatedBatch() {
  const [progress, setProgress] = useState<OutdatedBatchProgress>()
  const mounted = useRef(true)
  const active = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) active.current.stop = true
    }
  }, [])

  async function run(projects: RepoProject[], scan: Scan) {
    if (!mounted.current || active.current || !projects.length) return
    const job = { stop: false }
    active.current = job
    const queue = [...projects]
    let state: OutdatedBatchProgress = { status: 'running', total: queue.length, completed: 0, succeeded: 0, outdated: 0, score: 0, skipped: 0, failures: [], cacheWarnings: 0 }
    const isCurrent = () => mounted.current && active.current === job
    const publish = () => {
      if (isCurrent()) setProgress({ ...state, status: job.stop && state.status === 'running' ? 'stopping' : state.status })
    }

    try {
      for (const project of queue) {
        if (job.stop || !isCurrent()) break
        state = { ...state, current: { id: project.id, name: project.name } }
        publish()
        try {
          const result = await scan(project, isCurrent)
          state = {
            ...state,
            succeeded: state.succeeded + 1,
            outdated: state.outdated + (result?.outdated ? 1 : 0),
            score: Math.round((state.score + (result?.score ?? 0)) * 10) / 10,
            skipped: state.skipped + (result?.skipped ?? 0),
            // A successful save stores the whole workspace, including earlier results.
            cacheWarnings: result?.cacheWarning ? state.cacheWarnings + 1 : 0,
          }
        } catch (error) {
          state = { ...state, failures: [...state.failures, { id: project.id, name: project.name, message: error instanceof Error ? error.message : 'The outdated-package scan could not be completed.' }] }
        }
        state = { ...state, completed: state.completed + 1 }
        publish()
      }
    } finally {
      state = { ...state, current: undefined, status: state.completed === state.total ? 'completed' : 'stopped' }
      publish()
      if (active.current === job) active.current = null
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
