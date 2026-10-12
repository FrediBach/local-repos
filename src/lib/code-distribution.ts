import type { CodeLineBucket } from '../types'

/** At most 100 equal-width, inclusive integer ranges, starting at zero. */
export function codeDistribution(lineCounts: number[]): CodeLineBucket[] {
  if (!lineCounts.length) return []
  const maximum = lineCounts.reduce((max, lines) => Math.max(max, lines), 0)
  const width = Math.max(1, Math.ceil((maximum + 1) / 100))
  const buckets = Array.from({ length: Math.floor(maximum / width) + 1 }, (_, index) => ({
    minLines: index * width, maxLines: (index + 1) * width - 1, files: 0,
  }))
  for (const lines of lineCounts) buckets[Math.floor(lines / width)].files += 1
  return buckets
}
