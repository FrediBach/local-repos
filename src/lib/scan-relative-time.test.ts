import { describe, expect, it } from 'vitest'
import { scanRelativeTime } from './scan-relative-time'

const now = new Date(2026, 9, 11, 12).getTime()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

describe('scan report ages', () => {
  it.each([
    [0, 'just now'], [0.5, 'just now'], [1, '1 minute ago'], [2, '2 minutes ago'],
    [59, '59 minutes ago'], [60, '1 hour ago'], [90, '1½ hours ago'],
    [150, '2½ hours ago'], [180, '3 hours ago'], [1440, 'yesterday'],
    [2880, '2 days ago'], [10080, 'last week'], [20160, '2 weeks ago'],
    [43200, 'last month'], [86400, '2 months ago'], [525600, 'last year'],
    [1051200, '2 years ago'],
  ])('formats a scan %s minutes ago as %s', (minutes, expected) => {
    expect(scanRelativeTime(ago(minutes), now)).toBe(expected)
  })
  it('uses calendar days for yesterday', () => {
    expect(scanRelativeTime(new Date(2026, 9, 10, 23).toISOString(), now)).toBe('yesterday')
  })
  it('does not present unknown or future dates as a recent successful scan', () => {
    expect(scanRelativeTime('', now)).toBe('Date unavailable')
    expect(scanRelativeTime('invalid', now)).toBe('Date unavailable')
    expect(scanRelativeTime(ago(-60), now)).toBe('Date is in the future')
  })
})
