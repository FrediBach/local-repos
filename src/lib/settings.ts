import type { AuditSeverity, PackageAudit } from '../types'
import { normalizeColorScheme, type ColorScheme } from './color-schemes'

export type BadgeColor = 'red' | 'orange' | 'blue' | 'neutral'
export const badgeColors: BadgeColor[] = ['red', 'orange', 'blue', 'neutral']
export const auditSeverities: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']
export const SETTINGS_STORAGE_KEY = 'local-repos:settings:v2'
export const LEGACY_SETTINGS_STORAGE_KEY = 'local-repos:settings:v1'
export const PREFERENCES_CHANGED_EVENT = 'local-repos:preferences-changed'
export type WatcherMode = 'manual' | 'periodic' | 'changes'

export const numericSettings = {
  watcherIntervalMinutes: { label: 'Scan interval (minutes)', default: 60, min: 1, max: 10080, step: 1 },
  watcherPollSeconds: { label: 'Check for package changes (seconds)', default: 15, min: 5, max: 300, step: 1 },
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
  sidebarTechnologyLimit: { label: 'Technologies in sidebar', default: 50, min: 1, max: 50, step: 1 },
  projectTagLimit: { label: 'Technology tags per project', default: 3, min: 0, max: 20, step: 1 },
  packageMatchLimit: { label: 'Package matches per project', default: 3, min: 1, max: 20, step: 1 },
  statusPollSeconds: { label: 'Server status refresh (seconds)', default: 4, min: 1, max: 300, step: 1 },
  notificationSeconds: { label: 'Success notification duration (seconds)', default: 5.5, min: 0, max: 60, step: 0.5 },
} as const

export type NumericSettingKey = keyof typeof numericSettings
export type SettingsErrorKey = NumericSettingKey | 'pushReminderTime'
export const validReminderTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export type AppSettings = Record<NumericSettingKey, number> & {
  pushReminderEnabled: boolean
  pushReminderTime: string
  colorScheme: ColorScheme
  auditColors: Record<AuditSeverity, BadgeColor>
  majorUpdatesAreOrange: boolean
  watcherMode: WatcherMode
  watcherAudit: boolean
  watcherOutdated: boolean
  watcherStorage: boolean
}
export const defaultSettings: AppSettings = {
  pushReminderEnabled: true,
  pushReminderTime: '18:00',
  colorScheme: 'forest',
  ...Object.fromEntries(Object.entries(numericSettings).map(([key, field]) => [key, field.default])) as Record<NumericSettingKey, number>,
  auditColors: { critical: 'red', high: 'red', moderate: 'orange', low: 'blue', info: 'neutral' },
  majorUpdatesAreOrange: true,
  watcherMode: 'manual',
  watcherAudit: true,
  watcherOutdated: true,
  watcherStorage: false,
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
  result.colorScheme = normalizeColorScheme(value.colorScheme)
  if (validReminderTime(value.pushReminderTime)) result.pushReminderTime = value.pushReminderTime
  for (const key of Object.keys(numericSettings) as NumericSettingKey[]) {
    if (validNumber(key, value[key])) result[key] = value[key]
  }
  if (typeof value.majorUpdatesAreOrange === 'boolean') result.majorUpdatesAreOrange = value.majorUpdatesAreOrange
  if (['manual', 'periodic', 'changes'].includes(value.watcherMode as string)) result.watcherMode = value.watcherMode as WatcherMode
  for (const key of ['watcherAudit', 'watcherOutdated', 'watcherStorage', 'pushReminderEnabled'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
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

export function validateSettings(settings: AppSettings): Partial<Record<SettingsErrorKey, string>> {
  const errors: Partial<Record<SettingsErrorKey, string>> = {}
  if (settings.pushReminderEnabled && !validReminderTime(settings.pushReminderTime)) errors.pushReminderTime = 'Choose a valid reminder time.'
  for (const key of Object.keys(numericSettings) as NumericSettingKey[]) {
    if (key === 'watcherIntervalMinutes' && settings.watcherMode !== 'periodic' || key === 'watcherPollSeconds' && settings.watcherMode !== 'changes') continue
    const { min, max, step } = numericSettings[key]
    if (!validNumber(key, settings[key])) errors[key] = `Enter ${min}–${max} in steps of ${step}.`
  }
  for (const [lower, upper] of orderedSettings) {
    if (settings[lower] > settings[upper]) errors[upper] = `Must be at least ${settings[lower]} (${numericSettings[lower].label.toLowerCase()}).`
  }
  return errors
}

export function readSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved !== null) return normalizeSettings(JSON.parse(saved))
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY) ?? 'null')
    const settings = normalizeSettings(legacy)
    // Expand the old default for the scrollable sidebar. New saves use v2 so
    // choosing a limit of seven again remains an explicit, persistent choice.
    if (isRecord(legacy) && legacy.sidebarTechnologyLimit === 7) settings.sidebarTechnologyLimit = defaultSettings.sidebarTechnologyLimit
    return settings
  } catch { return normalizeSettings(null) }
}

export function highestAuditSeverity(report: PackageAudit): AuditSeverity | undefined {
  return auditSeverities.find(severity => report.counts[severity] > 0)
}
