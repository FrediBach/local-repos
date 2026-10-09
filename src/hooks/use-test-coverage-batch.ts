import { useEffect, useRef, useState } from 'react'
import { isCoverageProject } from '../lib/test-coverage'
import type { TestCoverageReport, RepoProject } from '../types'

export interface TestCoverageBatchProgress {
  status: 'running' | 'stopping' | 'completed' | 'stopped'
  total: number
  completed: number
  succeeded: number
  measured: number
  imported: number
  limited: number
  current?: Pick<RepoProject, 'id' | 'name'>
  failures: { id: string; name: string; message: string }[]
  cacheWarnings: number
}

type Scan = (project: RepoProject, isCurrent: () => boolean) => Promise<{ cacheWarning?: boolean; report: TestCoverageReport } | void>

/** Scan supported projects sequentially and stop only after the active request. */
export function useTestCoverageBatch() {
  const [progress, setProgress] = useState<TestCoverageBatchProgress>()
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
    if (!mounted.current || active.current) return
    const queue = projects.filter(isCoverageProject)
    if (!queue.length) return
    const job = { stop: false }
    active.current = job
    let state: TestCoverageBatchProgress = { status: 'running', total: queue.length, completed: 0, succeeded: 0, measured: 0, imported: 0, limited: 0, failures: [], cacheWarnings: 0 }
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
          if (!isCurrent()) break
          if (!result?.report) throw new Error('The helper did not return a test coverage report.')
          const { report } = result
          const measured = report.metrics.lines?.pct != null
          state = {
            ...state,
            succeeded: state.succeeded + 1,
            measured: state.measured + (measured ? 1 : 0),
            imported: state.imported + (report.source === 'existing-report' ? 1 : 0),
            limited: state.limited + (report.warning || !measured || !!report.exitCode ? 1 : 0),
            // A successful save stores the whole workspace, including earlier results.
            cacheWarnings: result.cacheWarning ? state.cacheWarnings + 1 : 0,
          }
        } catch (error) {
          state = { ...state, failures: [...state.failures, { id: project.id, name: project.name, message: error instanceof Error ? error.message : 'The test coverage scan could not be completed.' }] }
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
