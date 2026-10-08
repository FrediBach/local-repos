import { useEffect, useId, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import type { GitHistory } from '@/types'

// Local adaptation of https://www.shadcn.io/blocks/changelog-commit-frequency-heatmap.
// Uses real daily Git counts, the app's theme, and a keyboard-accessible SVG calendar.
export function CommitFrequencyHeatmap({ activity, from, to }: Pick<GitHistory, 'activity' | 'from' | 'to'>) {
  const id = useId()
  const calendar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = calendar.current
    if (!element) return
    const showRecent = () => { element.scrollLeft = element.scrollWidth - element.clientWidth }
    showRecent()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(showRecent)
    observer.observe(element)
    return () => observer.disconnect()
  }, [from, to])
  const counts = new Map(activity.map(day => [day.date, day.count]))
  const first = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  const calendarStart = new Date(first)
  calendarStart.setUTCDate(first.getUTCDate() - first.getUTCDay())
  const days: { date: string; count: number; week: number; weekday: number }[] = []
  for (const day = new Date(calendarStart); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    days.push({ date, count: counts.get(date) ?? 0, week: Math.floor((day.getTime() - calendarStart.getTime()) / 604_800_000), weekday: day.getUTCDay() })
  }
  const weeks = (days.at(-1)?.week ?? 0) + 1
  const total = activity.reduce((sum, day) => sum + day.count, 0)
  const maximum = Math.max(1, ...activity.map(day => day.count))
  const intensity = (count: number) => count === 0 ? 0 : Math.max(1, Math.ceil(count / maximum * 4))
  const months = days.filter(day => day.date >= from && (day.date.endsWith('-01') || day.date === from))
    .filter((day, index, all) => index === 0 || day.week - all[index - 1].week > 1)
  const formatDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'long' })

  return <section className="commit-heatmap" aria-label="Commit frequency">
    <div className="history-card-heading"><h4><CalendarDays size={16} />Commit activity</h4><span>Last 365 days · UTC</span></div>
    <div ref={calendar} className="heatmap-scroll" tabIndex={0} role="region" aria-label="Daily commit activity calendar">
      <svg viewBox={`0 0 ${weeks * 13 + 31} 115`} className="heatmap-calendar" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{total.toLocaleString()} commits in the last 365 days</title>
        <desc id={`${id}-description`}>Daily commit counts from {formatDay(from)} to {formatDay(to)}. Stronger color indicates more commits. Focus a square for its count.</desc>
        {months.map(day => <text key={day.date} x={31 + day.week * 13} y={10} className="heatmap-label">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</text>)}
        {[1, 3, 5].map((day, index) => <text key={day} x={0} y={27 + day * 13} className="heatmap-label">{['Mon', 'Wed', 'Fri'][index]}</text>)}
        {days.filter(day => day.date >= from).map(day => <rect key={day.date} x={31 + day.week * 13} y={19 + day.weekday * 13} width={10} height={10} rx={2}
          className={`heatmap-day heatmap-level-${intensity(day.count)}`} tabIndex={day.count ? 0 : undefined} role="img" aria-label={`${day.count} ${day.count === 1 ? 'commit' : 'commits'} on ${formatDay(day.date)}`}>
          <title>{day.count} {day.count === 1 ? 'commit' : 'commits'} on {formatDay(day.date)}</title>
        </rect>)}
      </svg>
    </div>
    <div className="heatmap-footer"><span><strong>{total.toLocaleString()}</strong> commits · <strong>{activity.length}</strong> active days</span><span className="heatmap-legend" aria-label="Activity scale from fewer to more commits">Less{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-level-${level}`} />)}More</span></div>
  </section>
}
