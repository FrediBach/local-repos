import { describe, expect, it, vi } from 'vitest'
import { defaultSettings, LEGACY_SETTINGS_STORAGE_KEY, normalizeSettings, readSettings, SETTINGS_STORAGE_KEY, validateSettings } from './settings'

describe('workspace settings', () => {
  it('expands the legacy sidebar default while retaining other preferences and subsequent custom limits', () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null })
    try {
      expect(readSettings().sidebarTechnologyLimit).toBe(50)
      saved.set(LEGACY_SETTINGS_STORAGE_KEY, JSON.stringify({ sidebarTechnologyLimit: 7, colorScheme: 'sand', watcherMode: 'changes', projectTagLimit: 2 }))
      expect(readSettings()).toMatchObject({ sidebarTechnologyLimit: 50, colorScheme: 'sand', watcherMode: 'changes', projectTagLimit: 2 })
      saved.set(LEGACY_SETTINGS_STORAGE_KEY, JSON.stringify({ sidebarTechnologyLimit: 12, colorScheme: 'plum' }))
      expect(readSettings()).toMatchObject({ sidebarTechnologyLimit: 12, colorScheme: 'plum' })
      saved.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...defaultSettings, sidebarTechnologyLimit: 7, colorScheme: 'ocean' }))
      expect(readSettings()).toMatchObject({ sidebarTechnologyLimit: 7, colorScheme: 'ocean' })
    } finally { vi.unstubAllGlobals() }
  })

  it('defaults push reminders to 18:00 and validates configurable local times', () => {
    expect(normalizeSettings({})).toMatchObject({ pushReminderEnabled: true, pushReminderTime: '18:00' })
    expect(normalizeSettings({ pushReminderEnabled: false, pushReminderTime: '17:30' })).toMatchObject({ pushReminderEnabled: false, pushReminderTime: '17:30' })
    for (const pushReminderTime of ['', '24:00', '18:60', '9:00', null, 1800]) {
      expect(normalizeSettings({ pushReminderTime }).pushReminderTime).toBe('18:00')
    }
    expect(validateSettings({ ...defaultSettings, pushReminderTime: '' })).toHaveProperty('pushReminderTime')
    expect(validateSettings({ ...defaultSettings, pushReminderTime: '', pushReminderEnabled: false })).toEqual({})
    for (const pushReminderTime of ['00:00', '17:30', '23:59']) expect(validateSettings({ ...defaultSettings, pushReminderTime })).toEqual({})
  })

  it('keeps older settings compatible and falls back safely for invalid color schemes', () => {
    for (const colorScheme of [undefined, null, '', 'unknown', 'toString', ['ocean'], {}]) {
      expect(normalizeSettings({ colorScheme, projectTagLimit: 2 })).toMatchObject({ colorScheme: 'forest', projectTagLimit: 2 })
    }
    for (const colorScheme of ['forest', 'ocean', 'plum', 'sand']) {
      expect(normalizeSettings({ colorScheme }).colorScheme).toBe(colorScheme)
    }
  })

  it('defaults to manual scans and normalizes invalid watcher preferences', () => {
    expect(normalizeSettings({})).toMatchObject({ watcherMode: 'manual', watcherIntervalMinutes: 60, watcherPollSeconds: 15 })
    expect(normalizeSettings({ watcherMode: 'always', watcherIntervalMinutes: 0, watcherPollSeconds: 1, watcherAudit: 'true' })).toMatchObject({ watcherMode: 'manual', watcherIntervalMinutes: 60, watcherPollSeconds: 15, watcherAudit: true })
    expect(normalizeSettings({ watcherMode: 'changes', watcherOutdated: false })).toMatchObject({ watcherMode: 'changes', watcherOutdated: false })
    expect(validateSettings({ ...defaultSettings, watcherMode: 'periodic', watcherIntervalMinutes: 0, watcherPollSeconds: NaN })).toHaveProperty('watcherIntervalMinutes')
    expect(validateSettings({ ...defaultSettings, watcherMode: 'changes', watcherIntervalMinutes: 0, watcherPollSeconds: NaN })).toHaveProperty('watcherPollSeconds')
    expect(validateSettings({ ...defaultSettings, watcherIntervalMinutes: 0, watcherPollSeconds: NaN })).toEqual({})
  })

  it('restores defaults for missing, invalid, and unsupported stored values', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings)
    expect(normalizeSettings([])).toEqual(defaultSettings)
    const settings = normalizeSettings({
      outdatedRedScore: 50, statusPollSeconds: 0, packageMatchLimit: '4', recentActivityDays: 2.5,
      notificationSeconds: Infinity, majorUpdatesAreOrange: false, auditColors: { high: 'blue', critical: 'purple' },
    })
    expect(settings).toMatchObject({ outdatedRedScore: 50, statusPollSeconds: 4, packageMatchLimit: 3, recentActivityDays: 7, notificationSeconds: 5.5, majorUpdatesAreOrange: false })
    expect(settings.auditColors).toEqual({ ...defaultSettings.auditColors, high: 'blue' })
    expect(defaultSettings.auditColors.high).toBe('red')
  })

  it('rejects inverted thresholds, empty values, fractional counts, and out-of-range numbers', () => {
    const errors = validateSettings({ ...defaultSettings, outdatedOrangeScore: 200, recentActivityDays: 50, statusPollSeconds: NaN, projectTagLimit: 1.5, largeProjectGiB: -1 })
    expect(Object.keys(errors).sort()).toEqual(['activeActivityDays', 'largeProjectGiB', 'outdatedRedScore', 'projectTagLimit', 'statusPollSeconds'])
    expect(validateSettings({ ...defaultSettings, notificationSeconds: 0, projectTagLimit: 0, outdatedRedMajorGap: 0 })).toEqual({})
  })

  it('normalizes corrupted ordering without retaining a newly invalid pair', () => {
    const settings = normalizeSettings({ outdatedOrangeScore: 1000, outdatedRedScore: 5, recentActivityDays: 100, activeActivityDays: 100, inactiveActivityDays: 20, dormantActivityDays: 10 })
    expect(validateSettings(settings)).toEqual({})
    expect(settings.outdatedOrangeScore).toBe(10)
    expect(settings.outdatedRedScore).toBe(100)
  })
})
