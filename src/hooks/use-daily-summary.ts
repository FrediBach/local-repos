import { useEffect, useMemo, useState } from 'react'
import { projectDay } from '@/lib/api'
import { dayRange, summaryRepositories, type SummaryRepository, type SummaryResult } from '@/lib/daily-summary'
import type { RepoProject } from '@/types'

/** Load at most three repositories at a time and discard results from stale requests. */
export function useDailySummary(projects: RepoProject[], helper: boolean, day: string, revision: number) {
  const [state, setState] = useState<{ key: string; results: SummaryResult[] }>({ key: '', results: [] })
  const repositories = summaryRepositories(projects)
  const repositoryKey = JSON.stringify(repositories)
  const key = JSON.stringify([day, revision, repositoryKey, helper])
  const range = dayRange(day)

  useEffect(() => {
    if (!helper) return
    const query = dayRange(day)
    if (!query) return
    let active = true
    const sources: SummaryRepository[] = JSON.parse(repositoryKey)
    let index = 0
    setState({ key, results: [] })
    // Keep large workspaces responsive without spawning a Git process for every
    // project at once. Requests already in flight cannot overwrite a newer day.
    void Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (active && index < sources.length) {
        const project = sources[index++]
        let result: SummaryResult
        try { result = { project, data: await projectDay(project.id, query) } }
        catch (error) { result = { project, error: error instanceof Error ? error.message : 'Could not load commits.' } }
        if (active) setState(previous => ({ key, results: [...previous.results, result] }))
      }
    }))
    return () => { active = false }
  }, [day, helper, repositoryKey, revision, key])

  const results = useMemo(() => state.key === key ? state.results : [], [state, key])
  const loading = helper && !!range && (state.key !== key || results.length < repositories.length)
  return { repositories, key, range, results, loading }
}
