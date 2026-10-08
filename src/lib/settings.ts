import type { AuditSeverity, PackageAudit } from '../types'

export type BadgeColor = 'red' | 'orange' | 'blue' | 'neutral'
export const badgeColors: BadgeColor[] = ['red', 'orange', 'blue', 'neutral']
export const auditSeverities: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']
export const SETTINGS_STORAGE_KEY = 'local-repos:settings:v1'

export const numericSettings = {
  outdatedOrangeScore: { label: 'Orange at score', default: 10, min: 0.1, max: 100000, step: 0.1 },
  outdatedRedScore: { label: 'Red at score', default: 100, min: 0.1, max: 100000, step: 0.1 },
  outdatedRedMajorGap: { label: 'Major versions behind for red', default: 2, min: 0, max: 100, step: 1 },
  majorVersionPoints: { label: 'Points per major version', default: 10, min: 0.1, max: 1000, step: 0.1 },
  minorVersionPoints: { label: 'Points per minor version', default: 1, min: 0.1, max: 1000, step: 0.1 },
  minorVersionCap: { label: 'Minor points cap per package', default: 5, min: 0.1, max: 10000, step: 0.1 },
  patchVersionPoints: { label: 'Points per patch version', default: 0.1, min: 0.1, max: 1000, step: 0.1 },
  patchVersionCap: { label: 'Patch points cap per package', default: 1, min: 0.1, max: 10000, step: 0.1 },
  prereleasePoints: { label: 'Points for a prerelease update', default: 0.1, min: 0.1, max: 1000, step: 0.1 },
  recentActivityDays: { label: 'Recent activity window (days)', default: 7, min: 1, max: 3650, step: 1 },
  activeActivityDays: { label: 'Active window (days)', default: 30, min: 1, max: 3650, step: 1 },
  inactiveActivityDays: { label: 'Inactive after (days)', default: 90, min: 1, max: 3650, step: 1 },
  dormantActivityDays: { label: 'Long inactive after (days)', default: 365, min: 1, max: 36500, step: 1 },
  largeProjectGiB: { label: 'Large project threshold (GiB)', default: 1, min: 0.1, max: 10000, step: 0.1 },
  heavyNodeModulesMiB: { label: 'Large node_modules threshold (MiB)', default: 500, min: 1, max: 1000000, step: 1 },
  sidebarTechnologyLimit: { label: 'Technologies in sidebar', default: 7, min: 1, max: 50, step: 1 },
  projectTagLimit: { label: 'Technology tags per project', default: 3, min: 0, max: 20, step: 1 },
  packageMatchLimit: { label: 'Package matches per project', default: 3, min: 1, max: 20, step: 1 },
  statusPollSeconds: { label: 'Server status refresh (seconds)', default: 4, min: 1, max: 300, step: 1 },
  notificationSeconds: { label: 'Success notification duration (seconds)', default: 5.5, min: 0, max: 60, step: 0.5 },
} as const

export type NumericSettingKey = keyof typeof numericSettings
export type AppSettings = Record<NumericSettingKey, number> & {
  auditColors: Record<AuditSeverity, BadgeColor>
  majorUpdatesAreOrange: boolean
}
export const defaultSettings: AppSettings = {
  ...Object.fromEntries(Object.entries(numericSettings).map(([key, field]) => [key, field.default])) as Record<NumericSettingKey, number>,
  auditColors: { critical: 'red', high: 'red', moderate: 'orange', low: 'blue', info: 'neutral' },
  majorUpdatesAreOrange: true,
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function validNumber(key: NumericSettingKey, value: unknown): value is number {
  const { min, max, step } = numericSettings[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && Math.abs(value / step - Math.round(value / step)) < 1e-7
}

/** Older, partial or malformed preferences retain safe defaults for unknown fields. */
export function normalizeSettings(value: unknown): AppSettings {
  const result = { ...defaultSettings, auditColors: { ...defaultSettings.auditColors } }
  if (!isRecord(value)) return result
  for (const key of Object.keys(numericSettings) as NumericSettingKey[]) {
    if (validNumber(key, value[key])) result[key] = value[key]
  }
  if (typeof value.majorUpdatesAreOrange === 'boolean') result.majorUpdatesAreOrange = value.majorUpdatesAreOrange
  if (isRecord(value.auditColors)) for (const severity of auditSeverities) {
    const color = value.auditColors[severity]
    if (badgeColors.includes(color as BadgeColor)) result.auditColors[severity] = color as BadgeColor
  }
  for (const [lower, upper] of orderedSettings) {
    if (result[lower] > result[upper]) {
      result[lower] = defaultSettings[lower]
      result[upper] = defaultSettings[upper]
    }
  }
  // An invalid activity sequence is restored together, so repairing one pair
  // cannot introduce another out-of-order pair.
  if (orderedSettings.slice(1).some(([lower, upper]) => result[lower] > result[upper])) {
    for (const key of activityKeys) result[key] = defaultSettings[key]
  }
  return result
}

const activityKeys = ['recentActivityDays', 'activeActivityDays', 'inactiveActivityDays', 'dormantActivityDays'] as const
const orderedSettings: [NumericSettingKey, NumericSettingKey][] = [
  ['outdatedOrangeScore', 'outdatedRedScore'],
  ['recentActivityDays', 'activeActivityDays'], ['activeActivityDays', 'inactiveActivityDays'], ['inactiveActivityDays', 'dormantActivityDays'],
]

export function validateSettings(settings: AppSettings): Partial<Record<NumericSettingKey, string>> {
  const errors: Partial<Record<NumericSettingKey, string>> = {}
  for (const key of Object.keys(numericSettings) as NumericSettingKey[]) {
    const { min, max, step } = numericSettings[key]
    if (!validNumber(key, settings[key])) errors[key] = `Enter ${min}–${max} in steps of ${step}.`
  }
  for (const [lower, upper] of orderedSettings) {
    if (settings[lower] > settings[upper]) errors[upper] = `Must be at least ${settings[lower]} (${numericSettings[lower].label.toLowerCase()}).`
  }
  return errors
}

export function readSettings(): AppSettings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null')) } catch { return normalizeSettings(null) }
}

export function highestAuditSeverity(report: PackageAudit): AuditSeverity | undefined {
  return auditSeverities.find(severity => report.counts[severity] > 0)
}
