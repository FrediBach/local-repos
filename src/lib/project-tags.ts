export type ProjectTags = Record<string, string[]>
export const suggestedTags = ['work', 'private', 'contributing']
export const tagNameLimit = 40
export const tagFilterValue = (tag: string) => `tag:${tag}`

export function normalizeTag(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map(normalizeTag)
    .filter(tag => tag.length > 0 && tag.length <= tagNameLimit && !/[\u0000-\u001f\u007f]/.test(tag)))].sort((a, b) => a.localeCompare(b))
}

export function readProjectTags(value: unknown): ProjectTags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([id, tags]) => [id, normalizeTags(tags)]).filter(([, tags]) => tags.length))
}
