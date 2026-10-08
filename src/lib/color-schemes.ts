export const colorSchemes = [
  { id: 'forest', name: 'Forest', description: 'Soft greens and warm neutrals' },
  { id: 'ocean', name: 'Ocean', description: 'Cool blues and misty grays' },
  { id: 'plum', name: 'Plum', description: 'Muted violet and lavender' },
  { id: 'sand', name: 'Sand', description: 'Warm stone and bronze' },
] as const

export type ColorScheme = typeof colorSchemes[number]['id']

export function normalizeColorScheme(value: unknown): ColorScheme {
  return colorSchemes.find(scheme => scheme.id === value)?.id ?? 'forest'
}
