import { describe, expect, it } from 'vitest'
import { configureOutdatedReport, formatOutdatedScore, outdatedLevel, outdatedScoreExplanation, scoreVersionGap, sumOutdatedScore } from './outdated'
import { defaultSettings } from './settings'
import type { PackageOutdated } from '../types'

describe('outdated scoring', () => {
  it('applies custom weights and caps to stored version gaps without mutating the report', () => {
    const report: PackageOutdated = { manager: 'npm', scannedAt: '2026-10-08T12:00:00Z', score: 21, level: 'moderate', findings: [
      { name: 'major', current: '1.0.0', latest: '3.0.0', change: 'major', majorGap: 2, score: 20 },
      { name: 'patch', current: '1.0.0', latest: '1.0.20', change: 'patch', majorGap: 0, score: 1 },
    ] }
    const settings = { ...defaultSettings, majorVersionPoints: 15, patchVersionPoints: 1, patchVersionCap: 4, outdatedRedScore: 30 }
    const configured = configureOutdatedReport(report, settings)
    expect(configured.score).toBe(34)
    expect(configured.level).toBe('high')
    expect(configured.findings.map(finding => finding.score)).toEqual([30, 4])
    expect(report.score).toBe(21)
    expect(report.findings[0].score).toBe(20)
    expect(configureOutdatedReport(report, defaultSettings)).toEqual(report)
    expect(scoreVersionGap('1.0.0', '1.5.0', { ...settings, minorVersionPoints: 2, minorVersionCap: 7 })?.score).toBe(7)
    expect(scoreVersionGap('1.0.0-rc.1', '1.0.0', { ...settings, prereleasePoints: 2 })?.score).toBe(2)
  })

  it('supports custom color thresholds and optional major-version conditions', () => {
    const settings = { ...defaultSettings, outdatedOrangeScore: 50, outdatedRedScore: 60, outdatedRedMajorGap: 0, majorUpdatesAreOrange: false }
    expect(outdatedLevel([{ score: 10, majorGap: 1 }], settings)).toBe('low')
    expect(outdatedLevel([{ score: 50, majorGap: 0 }], settings)).toBe('moderate')
    expect(outdatedLevel([{ score: 60, majorGap: 0 }], settings)).toBe('high')
    expect(outdatedLevel([], settings)).toBe('current')
    expect(outdatedScoreExplanation(settings)).toContain('Red requires at least 60 points.')
    expect(outdatedScoreExplanation(settings)).not.toContain('Any major update')
  })

  it.each([
    ['1.99.99', '3.0.0', 'major', 2, 20],
    ['1.1.99', '1.3.0', 'minor', 0, 2],
    ['1.1.0', '1.99.0', 'minor', 0, 5],
    ['1.1.0', '1.1.3', 'patch', 0, 0.3],
    ['1.1.0', '1.1.99', 'patch', 0, 1],
    ['1.0.0-rc.2', '1.0.0-rc.10', 'prerelease', 0, 0.1],
    ['1.0.0-rc.10', '1.0.0', 'prerelease', 0, 0.1],
    ['0.1.0', '0.2.0', 'minor', 0, 1],
  ])('scores %s → %s', (current, latest, change, majorGap, score) => {
    expect(scoreVersionGap(current, latest)).toEqual({ change, majorGap, score })
  })

  it.each([
    ['2.0.0', '1.99.99'], ['1.5.0', '1.4.9'], ['1.0.2', '1.0.1'],
    ['1.0.0', '1.0.0-rc.1'], ['1.0.0-beta.2', '1.0.0-beta.1'],
    ['1.0.0+one', '1.0.0+two'], ['v1.0.0', '1.0.0'],
  ])('does not penalize equal or ahead versions %s → %s', (current, latest) => {
    expect(scoreVersionGap(current, latest)).toBeNull()
  })

  it.each(['^1.0.0', 'workspace:*', 'latest', 'missing', '1.2', '01.0.0', '1.0.0-01', '99999999999999999.0.0'])('keeps unsupported %s distinct from current', version => {
    expect(scoreVersionGap(version, '2.0.0')).toBeUndefined()
    expect(scoreVersionGap('1.0.0', version)).toBeUndefined()
  })

  it('orders numeric and text prerelease components without treating build metadata as a release', () => {
    const versions = [
      '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
      '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0',
    ]
    for (let index = 1; index < versions.length; index++) {
      expect(scoreVersionGap(versions[index - 1], versions[index])).toEqual({ change: 'prerelease', majorGap: 0, score: 0.1 })
      expect(scoreVersionGap(versions[index], versions[index - 1])).toBeNull()
    }
    expect(scoreVersionGap('1.0.0-rc.99999999999999999999', '1.0.0-rc.100000000000000000000')).toEqual({ change: 'prerelease', majorGap: 0, score: 0.1 })
    expect(scoreVersionGap('1.0.0-beta+build.001', '1.0.0-beta+build.002')).toBeNull()
    expect(scoreVersionGap('1.0.0-beta+build.001', '1.0.0+build.001')).toEqual({ change: 'prerelease', majorGap: 0, score: 0.1 })
  })

  it('does not escalate frequent patch releases or one-major updates to red', () => {
    const patches = Array.from({ length: 1_000 }, () => ({ score: 0.1, majorGap: 0 }))
    expect(sumOutdatedScore(patches)).toBe(100)
    expect(outdatedLevel(patches)).toBe('moderate')
    expect(outdatedLevel(Array.from({ length: 10 }, () => ({ score: 10, majorGap: 1 })))).toBe('moderate')
    expect(outdatedLevel([{ score: 20, majorGap: 2 }])).toBe('moderate')
    expect(outdatedLevel([{ score: 9.9, majorGap: 0 }])).toBe('low')
    expect(outdatedLevel([{ score: 10, majorGap: 0 }])).toBe('moderate')
    expect(outdatedLevel([...Array.from({ length: 8 }, () => ({ score: 10, majorGap: 1 })), { score: 20, majorGap: 2 }])).toBe('high')
  })

  it('rounds sums and reserves red for substantial multi-major drift', () => {
    expect(sumOutdatedScore([{ score: 0.1 }, { score: 0.2 }])).toBe(0.3)
    expect(outdatedLevel([])).toBe('current')
    expect(outdatedLevel([{ score: 1, majorGap: 0 }])).toBe('low')
    expect(outdatedLevel([{ score: 10, majorGap: 1 }])).toBe('moderate')
    expect(outdatedLevel([{ score: 100, majorGap: 0 }])).toBe('moderate')
    expect(outdatedLevel([{ score: 99, majorGap: 2 }])).toBe('moderate')
    expect(outdatedLevel([{ score: 100, majorGap: 2 }])).toBe('high')
    expect(formatOutdatedScore(100)).toBe('100')
    expect(formatOutdatedScore(0.3)).toBe('0.3')
  })
})
