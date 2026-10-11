import { describe, expect, it } from 'vitest'
import { matchesFilterState, normalizeCustomFilters, validCustomFilters, type CustomFilter } from './project-filter-state'
import { defaultSettings, normalizeSettings } from './settings'
import { createConfigBackup, parseConfigBackup } from './config-backup'

const preset: CustomFilter = { id: 'react', name: 'React maintenance', filters: { stack: ['React'], tags: ['tag:Work'], audit: ['unscanned'] }, query: 'react', searchScope: 'packages', sort: 'name' }

describe('saved custom filters', () => {
  it('defaults older settings and backups while round-tripping names, criteria, and order', () => {
    expect(normalizeSettings({}).customFilters).toEqual([])
    const customFilters = [preset, { ...preset, id: 'other', name: 'Other', query: '' }]
    const backup = createConfigBackup({ ...defaultSettings, customFilters }, 'dark', [], [], {})
    expect(parseConfigBackup(JSON.stringify(backup)).settings.customFilters).toEqual(customFilters)
    const { customFilters: _, ...olderSettings } = backup.settings
    expect(parseConfigBackup(JSON.stringify({ ...backup, settings: olderSettings })).settings.customFilters).toEqual([])
  })

  it('drops corrupt and duplicate entries without losing valid presets or broadening their conditions', () => {
    const invalid = [null, { ...preset, name: ' ' }, { ...preset, id: '' }, { ...preset, filters: { unsupported: ['yes'] } },
      { ...preset, filters: { stack: 'React' } }, { ...preset, filters: { stack: [123] } }, { ...preset, sort: 'random' },
      { ...preset, query: 5 }, { ...preset, searchScope: 'unknown' }, { ...preset, name: 'x'.repeat(81) }]
    expect(normalizeCustomFilters([...invalid, preset, { ...preset, name: 'Duplicate' }, { ...preset, id: 'second', name: ' Second ' }])).toEqual([preset, { ...preset, id: 'second', name: 'Second' }])
    for (const entry of invalid) expect(validCustomFilters([entry])).toBe(false)
    expect(normalizeCustomFilters({})).toEqual([])
    expect(normalizeCustomFilters([{ ...preset, filters: { stack: ['Missing framework'] } }])[0].filters.stack).toEqual(['Missing framework'])
    const backup = createConfigBackup(defaultSettings, 'system', [], [], {})
    for (const customFilters of [[preset, preset], ...invalid.map(item => [item])]) {
      expect(() => parseConfigBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, customFilters } }))).toThrow('invalid custom filters')
    }
  })

  it('compares all saved criteria independently of multi-select order and empty groups', () => {
    const value = { ...preset, filters: { stack: ['React', 'Vue'], tags: [] } }
    expect(matchesFilterState(value, { ...value, filters: { stack: ['Vue', 'React'] } })).toBe(true)
    for (const changed of [{ query: 'other' }, { sort: 'updated' as const }, { searchScope: 'all' as const }, { filters: { stack: ['React'] } }]) {
      expect(matchesFilterState(value, { ...value, ...changed })).toBe(false)
    }
  })
})
