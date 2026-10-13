import type { PreviewCommitActivity } from '@/lib/commit-activity'
import './project-commit-activity.css'

export function ProjectCommitActivity({ activity }: { activity: PreviewCommitActivity }) {
  const total = activity.days.reduce((sum, day) => sum + (day.count ?? 0), 0)
  const maximum = Math.max(1, ...activity.days.map(day => day.count ?? 0))
  const partial = activity.shallow || activity.partial || activity.days.some(day => day.count === undefined)
  const summary = `Commit activity: ${total} cached commits · last ${activity.days.length} days (UTC) · ${activity.author || 'All authors'}${partial ? ' · partial coverage' : ''}`
  const description = `${summary}. ${activity.days[0]?.date} to ${activity.days.at(-1)?.date}. All locally available branches. Cached ${new Date(activity.cachedAt).toLocaleString()}.${activity.shallow ? ' Shallow repository: only downloaded history is included.' : ''} Hollow marks have no cached activity; days with zero commits are left blank. Sync projects to refresh.`
  return <svg className="project-commit-activity" viewBox={`0 0 ${activity.days.length * 3} 36`} preserveAspectRatio="none" role="img" aria-label={description}>
    <title>{description}</title>
    {activity.days.map((day, index) => {
      if (day.count === 0) return null
      const height = day.count ? Math.max(3, day.count / maximum * 36) : 1.5
      // SVG fills the open bottom edge without stroking it.
      return <path key={day.date} d={`M ${index * 3} 36 V ${36 - height} H ${index * 3 + 2.5} V 36`}
        vectorEffect="non-scaling-stroke"
        className={day.count === undefined ? 'is-unknown' : undefined}>
        <title>{day.date}: {day.count === undefined ? 'No cached activity' : `${day.count} cached commits${activity.shallow ? ' (shallow history)' : ''}`}</title>
      </path>
    })}
  </svg>
}
