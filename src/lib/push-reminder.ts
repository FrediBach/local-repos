import { localDate, type SummaryRepository } from './daily-summary'
import { validReminderTime } from './settings'
import type { GitPushStatus } from '@/types'

export interface PushReminderResult { project: SummaryRepository; status?: GitPushStatus; error?: string }
export const PUSH_REMINDER_DISMISSALS_KEY = 'local-repos:push-reminder-dismissals:v1'

export function reminderDue(time: string, now = new Date()): boolean {
  if (!validReminderTime(time)) return false
  const [hour, minute] = time.split(':').map(Number)
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute
}

export function needsPushReminder({ status, error }: PushReminderResult): boolean {
  return !!error || !!status?.available && status.hasOrigin && (status.unpushedCommits > 0 || status.dirty || !status.originRefsKnown)
}

export function reminderDismissed(workspace: string, day = localDate()): boolean {
  try { return JSON.parse(localStorage.getItem(PUSH_REMINDER_DISMISSALS_KEY) ?? '{}')?.[workspace] === day } catch { return false }
}

export function dismissPushReminder(workspace: string, day = localDate()): void {
  try {
    const previous: unknown = JSON.parse(localStorage.getItem(PUSH_REMINDER_DISMISSALS_KEY) ?? '{}')
    const today = previous && typeof previous === 'object' && !Array.isArray(previous) ? Object.fromEntries(Object.entries(previous).filter(([, value]) => value === day)) : {}
    localStorage.setItem(PUSH_REMINDER_DISMISSALS_KEY, JSON.stringify({ ...today, [workspace]: day }))
  } catch { /* The hook also retains dismissal in memory when storage is unavailable. */ }
}
