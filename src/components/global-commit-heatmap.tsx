import { useId } from 'react'
import type { GlobalCommitActivity } from '@/lib/commit-activity'
import './global-commit-heatmap.css'

export function GlobalCommitHeatmap({ activity }: { activity: GlobalCommitActivity }) {
  const id = useId()
  const total = activity.days.reduce((sum, day) => sum + day.count, 0)
  const maximum = Math.max(1, ...activity.days.map(day => day.count))
  const summary = `${total} cached commits · ${activity.cachedRepositories} of ${activity.repositories} repositories · last 13 weeks (UTC) · ${activity.author || 'All authors'}`
  return <div className="global-commit-heatmap" tabIndex={0} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} title={`${summary}. Cached ${new Date(activity.cachedAt).toLocaleString()}. Sync projects to refresh activity.`}>
    <svg viewBox="0 0 77 41" aria-hidden="true">
      <title id={`${id}-title`}>Global commit activity: {summary}</title>
      <desc id={`${id}-description`}>Activity from cached project histories for {activity.author || 'all authors'}. Stronger color means more commits. Outlined squares have no cached coverage; muted squares have partial coverage. Sync projects to refresh.</desc>
      {activity.days.map((day, index) => <rect key={day.date} x={Math.floor(index / 7) * 6} y={index % 7 * 6} width={5} height={5} rx={1}
        className={`global-commit-day level-${day.count ? Math.max(1, Math.ceil(day.count / maximum * 4)) : 0}${!day.covered ? ' is-unknown' : day.partial ? ' is-partial' : ''}`}>
        <title>{day.date}: {day.covered ? `${day.count} cached commits${day.partial ? ' (partial coverage)' : ''}` : 'No cached activity'}</title>
      </rect>)}
    </svg>
  </div>
}
