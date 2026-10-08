import { describe, expect, it } from 'vitest'
import { normalizeTags, readProjectTags, tagFilterValue } from './project-tags'
import { filterOptionCounts, matchesProjectFilters, projectFilterGroups } from './project-filters'
import type { RepoProject } from '../types'

describe('tag preferences and filtering', () => {
  it('normalizes labels and ignores invalid stored data without losing other projects', () => {
    expect(normalizeTags([' Work ', 'work', 'ＷＯＲＫ', 'side   project', '', null, 'x'.repeat(41), '\u0000bad'])).toEqual(['side project', 'work'])
    expect(readProjectTags({ alpha: ['Work'], beta: 'not an array', gamma: ['Private'] })).toEqual({ alpha: ['work'], gamma: ['private'] })
    expect(readProjectTags(null)).toEqual({})
    expect(readProjectTags([])).toEqual({})
    expect(readProjectTags(JSON.parse('{"__proto__":["work"]}'))['__proto__']).toEqual(['work'])
  })

  it('counts tags against other groups and distinguishes an untagged project from a tag named untagged', () => {
    const base: RepoProject = { id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'alpha', description: '', stack: ['React'], scripts: {}, packageManager: 'npm', scannedAt: '' }
    const projects = [{ ...base, tags: ['work', 'untagged'] }, { ...base, id: 'beta', tags: ['private'] }, { ...base, id: 'gamma' }]
    const filters = { tags: [tagFilterValue('private')], stars: ['starred'] }
    const groups = projectFilterGroups(projects, filters)
    const context = { favorites: ['alpha'], now: Date.now() }
    expect(filterOptionCounts(projects, filters, groups, context).tags).toMatchObject({ 'tag:work': 1, 'tag:private': 0, untagged: 0 })
    expect(projects.filter(p => matchesProjectFilters(p, { tags: ['untagged'] }, groups, context)).map(p => p.id)).toEqual(['gamma'])
    expect(projects.filter(p => matchesProjectFilters(p, { tags: [tagFilterValue('untagged')] }, groups, context)).map(p => p.id)).toEqual(['alpha'])
    const retained = projectFilterGroups([], { tags: [tagFilterValue('work')] })
    expect(retained.find(group => group.key === 'tags')?.options.some(option => option.value === tagFilterValue('work'))).toBe(true)
  })
})
