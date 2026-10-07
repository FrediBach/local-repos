import { useEffect, useRef, useState } from 'react'
import type { RepoProject } from '../types'

export interface PreviewBatchProgress {
  status: 'running' | 'stopping' | 'completed' | 'stopped'
  total: number
  completed: number
  succeeded: number
  current?: Pick<RepoProject, 'id' | 'name'>
  failures: { id: string; name: string; message: string }[]
  cacheWarnings: number
}

type Capture = (project: RepoProject, isCurrent: () => boolean) => Promise<{ cacheWarning?: boolean } | void>

/** One request at a time, with progress based on completed captures only. */
export function usePreviewBatch() {
  const [progress, setProgress] = useState<PreviewBatchProgress>()
  const mounted = useRef(true)
  const active = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) active.current.stop = true
    }
  }, [])

  async function run(projects: RepoProject[], capture: Capture) {
    if (active.current || !projects.length) return
    const job = { stop: false }
    active.current = job
    const queue = [...projects]
    let state: PreviewBatchProgress = { status: 'running', total: queue.length, completed: 0, succeeded: 0, failures: [], cacheWarnings: 0 }
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
          const result = await capture(project, isCurrent)
          // Each successful cache write saves the whole workspace, including earlier captures.
          state = { ...state, succeeded: state.succeeded + 1, cacheWarnings: result?.cacheWarning ? state.cacheWarnings + 1 : 0 }
        } catch (error) {
          state = { ...state, failures: [...state.failures, { id: project.id, name: project.name, message: error instanceof Error ? error.message : 'The preview could not be captured.' }] }
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
    if (!active.current) return
    active.current.stop = true
    setProgress(current => current && ({ ...current, status: 'stopping' }))
  }

  return {
    progress, run, stop,
    isActive: () => active.current !== null,
    dismiss: () => { if (!active.current) setProgress(undefined) },
  }
}
