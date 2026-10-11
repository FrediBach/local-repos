/** Readable report ages; missing dates never imply a recent successful scan. */
export function scanRelativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Date unavailable'
  const minutes = (now - timestamp) / 60_000
  if (minutes < -1) return 'Date is in the future'
  if (minutes < 1) return 'just now'
  if (minutes < 60) {
    const count = Math.floor(minutes)
    return `${count} ${count === 1 ? 'minute' : 'minutes'} ago`
  }
  const date = new Date(timestamp)
  const today = new Date(now)
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000)
  if (days === 1) return 'yesterday'
  if (minutes < 1440) {
    const halves = Math.floor(minutes / 30)
    const hours = Math.floor(halves / 2)
    return `${hours}${halves % 2 ? '½' : ''} ${halves === 2 ? 'hour' : 'hours'} ago`
  }
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 60) return 'last month'
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'last year' : `${years} years ago`
}
