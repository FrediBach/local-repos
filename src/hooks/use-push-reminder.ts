import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { projectPushStatus } from '@/lib/api'
import { localDate, summaryRepositories, type SummaryRepository } from '@/lib/daily-summary'
import { dismissPushReminder, needsPushReminder, PUSH_REMINDER_DISMISSALS_KEY, reminderDismissed, reminderDue, type PushReminderResult } from '@/lib/push-reminder'
import type { AppSettings } from '@/lib/settings'
import type { Workspace } from '@/types'

interface Props { workspace?: Workspace; settings: AppSettings; busy: boolean }
interface State { key: string; day: string; results: PushReminderResult[]; checking: boolean }

export function usePushReminder({ workspace, settings, busy }: Props) {
  const root = workspace?.mode === 'helper' ? workspace.rootPath ?? workspace.rootName : ''
  const enabled = !!root && settings.pushReminderEnabled
  const time = settings.pushReminderTime
  const repositories = JSON.stringify(summaryRepositories(workspace?.projects ?? []))
  const key = JSON.stringify([root, repositories, time, enabled])
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<State>({ key: '', day: '', results: [], checking: false })
  const dismissed = useRef(new Map<string, string>())
  const context = useRef({ busy })
  useLayoutEffect(() => { context.current = { busy } }, [busy])

  useEffect(() => {
    if (!enabled) return
    let active = true
    let inFlight = false
    let nextCheck = 0
    const sources: SummaryRepository[] = JSON.parse(repositories)
    const isDismissed = (day: string) => dismissed.current.get(root) === day || reminderDismissed(root, day)
    const tick = async () => {
      const now = new Date()
      const day = localDate(now)
      if (!reminderDue(time, now) || isDismissed(day)) {
        setState(previous => previous.results.length || previous.checking ? { key, day, results: [], checking: false } : previous)
        nextCheck = 0
        return
      }
      if (inFlight || context.current.busy || document.visibilityState === 'hidden' || now.getTime() < nextCheck) return
      inFlight = true
      nextCheck = now.getTime() + 5 * 60_000
      setState(previous => ({ key, day, results: previous.key === key && previous.day === day ? previous.results : [], checking: true }))
      const results: PushReminderResult[] = []
      let index = 0
      await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
        while (active && index < sources.length) {
          const project = sources[index++]
          try { results.push({ project, status: await projectPushStatus(project.id) }) }
          catch (error) { results.push({ project, error: error instanceof Error ? error.message : 'Could not check this repository.' }) }
        }
      }))
      inFlight = false
      if (!active) return
      const current = new Date()
      const stillDue = localDate(current) === day && reminderDue(time, current) && !isDismissed(day)
      setState({ key, day, results: stillDue ? results.filter(needsPushReminder).sort((a, b) => a.project.name.localeCompare(b.project.name)) : [], checking: false })
    }
    const check = () => { void tick() }
    const onStorage = (event: StorageEvent) => { if (event.key === PUSH_REMINDER_DISMISSALS_KEY) check() }
    check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('storage', onStorage)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled, key, repositories, revision, root, time])

  const current = enabled && state.key === key && state.day === localDate() && reminderDue(time)
  return {
    results: current ? state.results : [],
    checking: current && state.checking,
    refresh: () => setRevision(value => value + 1),
    dismiss: () => {
      const day = localDate()
      dismissed.current.set(root, day)
      dismissPushReminder(root, day)
      setState({ key, day, results: [], checking: false })
    },
  }
}
