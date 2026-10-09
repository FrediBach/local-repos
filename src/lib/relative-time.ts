export function relativeTime(value?: string) {
  if (!value) return 'Just scanned'
  const minutes = Math.max(0, (Date.now() - Date.parse(value)) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
