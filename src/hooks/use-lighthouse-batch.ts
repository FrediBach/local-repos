import { useEffect, useRef, useState } from 'react'
import { isLighthouseProject, lighthousePerformanceScore } from '../lib/lighthouse'
import type { LighthouseReport, RepoProject } from '../types'

export interface LighthouseBatchProgress {
  status: 'running' | 'stopping' | 'completed' | 'stopped'
  total: number
  completed: number
  succeeded: number
  withFindings: number
  findings: number
  scoreTotal: number
  scored: number
  limited: number
  current?: Pick<RepoProject, 'id' | 'name'>
  failures: { id: string; name: string; message: string }[]
  cacheWarnings: number
}

type Scan = (project: RepoProject, isCurrent: () => boolean) => Promise<{ cacheWarning?: boolean; report: LighthouseReport } | void>

/** Scan frontend projects sequentially and stop only after the active request. */
export function useLighthouseBatch() {
  const [progress, setProgress] = useState<LighthouseBatchProgress>()
  const mounted = useRef(true)
  const active = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (active.current) active.current.stop = true
    }
  }, [])

  async function run(projects: RepoProject[], scan: Scan, isWorkspaceCurrent: () => boolean = () => true) {
    if (!mounted.current || active.current || !isWorkspaceCurrent()) return
    const queue = projects.filter(isLighthouseProject)
    if (!queue.length) return
    const job = { stop: false }
    active.current = job
    let state: LighthouseBatchProgress = { status: 'running', total: queue.length, completed: 0, succeeded: 0, withFindings: 0, findings: 0, scoreTotal: 0, scored: 0, limited: 0, failures: [], cacheWarnings: 0 }
    const isCurrent = () => mounted.current && active.current === job && isWorkspaceCurrent()
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
          if (!result?.report) throw new Error('The helper did not return a Lighthouse report.')
          const { report } = result
          const score = lighthousePerformanceScore(report)
          const findings = report.audits.filter(audit => (audit.score !== null && audit.score < 1) || audit.scoreDisplayMode === 'error').length
          const scored = typeof score === 'number' && Number.isFinite(score)
          state = {
            ...state,
            succeeded: state.succeeded + 1,
            withFindings: state.withFindings + (findings > 0 ? 1 : 0),
            findings: state.findings + findings,
            scoreTotal: state.scoreTotal + (scored ? score : 0),
            scored: state.scored + (scored ? 1 : 0),
            limited: state.limited + (report.warnings.length || !scored || report.categories.length < 4 || report.categories.some(category => category.score === null) ? 1 : 0),
            // A successful save stores the whole workspace, including earlier results.
            cacheWarnings: result.cacheWarning ? state.cacheWarnings + 1 : 0,
          }
        } catch (error) {
          state = { ...state, failures: [...state.failures, { id: project.id, name: project.name, message: error instanceof Error ? error.message : 'The Lighthouse scan could not be completed.' }] }
        }
        state = { ...state, completed: state.completed + 1 }
        publish()
      }
    } finally {
      state = { ...state, current: undefined, status: state.completed === state.total ? 'completed' : 'stopped' }
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
