import type { CodeLineBucket } from '../types'

/** At most ten equal-width, inclusive integer ranges, starting at zero. */
export function codeDistribution(lineCounts: number[]): CodeLineBucket[] {
  if (!lineCounts.length) return []
  const maximum = lineCounts.reduce((max, lines) => Math.max(max, lines), 0)
  const targetWidth = Math.max(1, Math.ceil((maximum + 1) / 10))
  const magnitude = 10 ** Math.floor(Math.log10(targetWidth))
  const width = [1, 2, 5, 10].map(factor => factor * magnitude).find(size => size >= targetWidth)!
  const buckets = Array.from({ length: Math.floor(maximum / width) + 1 }, (_, index) => ({
    minLines: index * width, maxLines: (index + 1) * width - 1, files: 0,
  }))
  for (const lines of lineCounts) buckets[Math.floor(lines / width)].files += 1
  return buckets
}
