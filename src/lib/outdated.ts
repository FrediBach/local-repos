import type { OutdatedFinding, OutdatedLevel } from '../types'

export const OUTDATED_SCORE_EXPLANATION = 'Scores use the highest changed version component: 10 points per major version; 1 per minor version (maximum 5 per package); 0.1 per patch (maximum 1 per package); 0.1 for a prerelease update. Scores are summed. Red requires at least 100 points and a package at least 2 major versions behind. Any major update or 10 points is amber; smaller updates stay neutral.'

interface Version { core: number[]; prerelease: string[] }

function parseVersion(value: string): Version | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim())
  if (!match) return undefined
  const core = match.slice(1, 4).map(Number)
  const prerelease = match[4]?.split('.') ?? []
  if (core.some(part => !Number.isSafeInteger(part)) || prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return undefined
  return { core, prerelease }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (!left.length || !right.length) return left.length === right.length ? 0 : left.length ? -1 : 1
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index], b = right[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const aNumber = /^\d+$/.test(a), bNumber = /^\d+$/.test(b)
    if (aNumber && bNumber) return a.length === b.length ? (a < b ? -1 : 1) : a.length - b.length
    if (aNumber !== bNumber) return aNumber ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

/** Undefined means unscorable; null means current or ahead of the latest tag. */
export function scoreVersionGap(current: string, latest: string): Pick<OutdatedFinding, 'change' | 'majorGap' | 'score'> | null | undefined {
  const from = parseVersion(current), to = parseVersion(latest)
  if (!from || !to) return undefined
  for (let index = 0; index < 3; index++) {
    const gap = to.core[index] - from.core[index]
    if (gap < 0) return null
    if (gap > 0) return {
      change: (['major', 'minor', 'patch'] as const)[index],
      majorGap: index === 0 ? gap : 0,
      score: index === 0 ? gap * 10 : index === 1 ? Math.min(gap, 5) : Math.min(gap, 10) / 10,
    }
  }
  return comparePrerelease(from.prerelease, to.prerelease) < 0 ? { change: 'prerelease', majorGap: 0, score: 0.1 } : null
}

export function sumOutdatedScore(findings: Pick<OutdatedFinding, 'score'>[]): number {
  return Math.round(findings.reduce((sum, finding) => sum + finding.score, 0) * 10) / 10
}

export function outdatedLevel(findings: Pick<OutdatedFinding, 'score' | 'majorGap'>[]): OutdatedLevel {
  if (!findings.length) return 'current'
  const score = sumOutdatedScore(findings)
  if (score >= 100 && findings.some(finding => finding.majorGap >= 2)) return 'high'
  return score >= 10 || findings.some(finding => finding.majorGap > 0) ? 'moderate' : 'low'
}

export function formatOutdatedScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}
