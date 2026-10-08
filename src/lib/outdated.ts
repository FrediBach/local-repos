import type { OutdatedFinding, OutdatedLevel, PackageOutdated } from '../types'
import { defaultSettings, type AppSettings } from './settings'

export function outdatedScoreExplanation(settings: AppSettings = defaultSettings): string {
  return `Scores use the highest changed version component: ${settings.majorVersionPoints} points per major version; ${settings.minorVersionPoints} per minor version (maximum ${settings.minorVersionCap} per package); ${settings.patchVersionPoints} per patch (maximum ${settings.patchVersionCap} per package); ${settings.prereleasePoints} for a prerelease update. Scores are summed. Red requires at least ${settings.outdatedRedScore} points${settings.outdatedRedMajorGap ? ` and a package at least ${settings.outdatedRedMajorGap} major versions behind` : ''}. ${settings.majorUpdatesAreOrange ? 'Any major update or ' : ''}${settings.outdatedOrangeScore} points is orange; smaller updates stay neutral.`
}
export const OUTDATED_SCORE_EXPLANATION = outdatedScoreExplanation()

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
export function scoreVersionGap(current: string, latest: string, settings: AppSettings = defaultSettings): Pick<OutdatedFinding, 'change' | 'majorGap' | 'score'> | null | undefined {
  const from = parseVersion(current), to = parseVersion(latest)
  if (!from || !to) return undefined
  for (let index = 0; index < 3; index++) {
    const gap = to.core[index] - from.core[index]
    if (gap < 0) return null
    if (gap > 0) return {
      change: (['major', 'minor', 'patch'] as const)[index],
      majorGap: index === 0 ? gap : 0,
      score: Math.round((index === 0 ? gap * settings.majorVersionPoints : index === 1 ? Math.min(gap * settings.minorVersionPoints, settings.minorVersionCap) : Math.min(gap * settings.patchVersionPoints, settings.patchVersionCap)) * 10) / 10,
    }
  }
  return comparePrerelease(from.prerelease, to.prerelease) < 0 ? { change: 'prerelease', majorGap: 0, score: settings.prereleasePoints } : null
}

export function sumOutdatedScore(findings: Pick<OutdatedFinding, 'score'>[]): number {
  return Math.round(findings.reduce((sum, finding) => sum + finding.score, 0) * 10) / 10
}

export function outdatedLevel(findings: Pick<OutdatedFinding, 'score' | 'majorGap'>[], settings: AppSettings = defaultSettings): OutdatedLevel {
  if (!findings.length) return 'current'
  const score = sumOutdatedScore(findings)
  if (score >= settings.outdatedRedScore && findings.some(finding => finding.majorGap >= settings.outdatedRedMajorGap)) return 'high'
  return score >= settings.outdatedOrangeScore || (settings.majorUpdatesAreOrange && findings.some(finding => finding.majorGap > 0)) ? 'moderate' : 'low'
}

/** Recalculate the presentation of cached reports without changing scan data. */
export function configureOutdatedReport(report: PackageOutdated, settings: AppSettings): PackageOutdated {
  const findings = report.findings.map(finding => ({ ...finding, ...scoreVersionGap(finding.current, finding.latest, settings) }))
  return { ...report, findings, score: sumOutdatedScore(findings), level: outdatedLevel(findings, settings) }
}

export function formatOutdatedScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}
