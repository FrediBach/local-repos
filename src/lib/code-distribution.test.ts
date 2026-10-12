import { expect, it } from 'vitest'
import { codeDistribution } from './code-distribution'

it('places boundary values in exactly one equal-width range, retaining empty ranges', () => {
  const buckets = codeDistribution([0, 99, 100, 199, 200, 999])
  expect(buckets).toHaveLength(10)
  expect(buckets.map(bucket => bucket.files)).toEqual([2, 2, 1, 0, 0, 0, 0, 0, 0, 1])
  expect(buckets[0]).toEqual({ minLines: 0, maxLines: 99, files: 2 })
  expect(buckets[9]).toEqual({ minLines: 900, maxLines: 999, files: 1 })
})

it('distinguishes no files from zero-line files and covers large outliers within ten bins', () => {
  expect(codeDistribution([])).toEqual([])
  expect(codeDistribution([0, 0])).toEqual([{ minLines: 0, maxLines: 0, files: 2 }])
  for (const maximum of [1, 9, 10, 100, 1000, 524288]) {
    const buckets = codeDistribution([0, maximum, maximum])
    expect(buckets.length).toBeLessThanOrEqual(10)
    expect(buckets.reduce((sum, bucket) => sum + bucket.files, 0)).toBe(3)
    expect(buckets.at(-1)?.maxLines).toBeGreaterThanOrEqual(maximum)
    expect(buckets.at(-1)?.files).toBe(2)
    expect(new Set(buckets.map(bucket => bucket.maxLines - bucket.minLines)).size).toBe(1)
  }
})
