export type FilterKey = 'tags' | 'stars' | 'audit' | 'outdated' | 'git' | 'server' | 'activity' | 'structure' | 'storage' | 'preview' | 'readme' | 'stack' | 'manager' | 'branch' | 'license'
export type ProjectFilters = Partial<Record<FilterKey, string[]>>
export type ProjectSort = 'updated' | 'oldest' | 'name' | 'stack' | 'vulnerabilities' | 'outdated' | 'size' | 'dependencies' | 'favorites'
export const projectSortOptions: { value: ProjectSort; label: string }[] = [
  { value: 'updated', label: 'Last updated' }, { value: 'oldest', label: 'Least recently updated' },
  { value: 'name', label: 'Name A–Z' }, { value: 'stack', label: 'Technology' },
  { value: 'vulnerabilities', label: 'Vulnerability severity' }, { value: 'outdated', label: 'Package lag' },
  { value: 'size', label: 'Largest on disk' }, { value: 'dependencies', label: 'Largest node_modules' },
  { value: 'favorites', label: 'Starred first' },
]

export interface ProjectFilterState {
  filters: ProjectFilters
  query: string
  searchScope: 'all' | 'packages'
  sort: ProjectSort
}

export interface CustomFilter extends ProjectFilterState {
  id: string
  name: string
}

export const customFilterNameLimit = 80
const filterKeys: FilterKey[] = ['tags', 'stars', 'audit', 'outdated', 'git', 'server', 'activity', 'structure', 'storage', 'preview', 'readme', 'stack', 'manager', 'branch', 'license']
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value)
export const validCustomFilterName = (value: unknown): value is string => isText(value, customFilterNameLimit) && !!value.trim()

function readCustomFilter(value: unknown): CustomFilter | undefined {
  if (!isRecord(value) || !isText(value.id, 128) || !value.id.trim() || !validCustomFilterName(value.name) || !isRecord(value.filters)) return
  const filters: ProjectFilters = {}
  for (const [key, values] of Object.entries(value.filters)) {
    // Discard an invalid preset as a whole so lost conditions never broaden it.
    if (!filterKeys.includes(key as FilterKey) || !Array.isArray(values) || values.length > 250 || values.some(item => !isText(item, 1024) || !item)) return
    if (values.length) filters[key as FilterKey] = [...new Set(values as string[])]
  }
  const query = value.query ?? ''
  const searchScope = value.searchScope ?? 'all'
  const sort = value.sort ?? 'updated'
  if (!isText(query, 4096) || (searchScope !== 'all' && searchScope !== 'packages') || !projectSortOptions.some(option => option.value === sort)) return
  return { id: value.id, name: value.name.trim(), filters, query, searchScope, sort: sort as ProjectSort }
}

/** Missing older preferences default to no presets; preserve valid entries and order. */
export function normalizeCustomFilters(value: unknown): CustomFilter[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.flatMap(entry => {
    const filter = readCustomFilter(entry)
    if (!filter || ids.has(filter.id)) return []
    ids.add(filter.id)
    return [filter]
  })
}

export function validCustomFilters(value: unknown): boolean {
  return Array.isArray(value) && normalizeCustomFilters(value).length === value.length
}

export function matchesFilterState(a: ProjectFilterState, b: ProjectFilterState): boolean {
  return a.query.trim() === b.query.trim() && a.searchScope === b.searchScope && a.sort === b.sort && filterKeys.every(key => {
    const left = new Set(a.filters[key])
    const right = new Set(b.filters[key])
    return left.size === right.size && [...left].every(value => right.has(value))
  })
}
