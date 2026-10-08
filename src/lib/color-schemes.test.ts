// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { colorSchemes } from './color-schemes'

const css = readFileSync('src/theme.css', 'utf8')
const html = readFileSync('index.html', 'utf8')
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1]

beforeEach(() => {
  document.head.innerHTML = `<style>${css}</style><meta name="theme-color" content="">`
})
afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.colorScheme
})

function luminance(hex: string) {
  expect(hex).toMatch(/^#[\da-f]{6}$/i)
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

const combinations = colorSchemes.flatMap(scheme => ['light', 'dark'].map(mode => ({ scheme: scheme.id, mode })))

it.each(combinations)('$scheme / $mode has readable text, distinct controls and visible focus indicators', ({ scheme, mode }) => {
  document.documentElement.dataset.colorScheme = scheme
  document.documentElement.dataset.theme = mode
  const styles = getComputedStyle(document.documentElement)
  const color = (token: string) => styles.getPropertyValue(`--${token}`).trim()
  const contrast = (foreground: string, background: string, minimum: number) => {
    const values = [luminance(color(foreground)), luminance(color(background))].sort((a, b) => b - a)
    expect((values[0] + 0.05) / (values[1] + 0.05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum)
  }
  const surfaces = ['background', 'surface', 'surface-muted', 'sidebar', 'hover', 'accent-soft']
  for (const surface of surfaces) {
    for (const text of ['foreground', 'muted-foreground', 'accent', 'warm']) contrast(text, surface, 4.5)
    for (const indicator of ['control-border', 'focus', 'primary']) contrast(indicator, surface, 3)
  }
  for (const status of ['danger', 'warning', 'info']) {
    for (const surface of ['background', 'surface', 'surface-muted', `${status}-soft`]) contrast(status, surface, 4.5)
  }
  contrast('primary-foreground', 'primary', 4.5)
  contrast('primary-foreground', 'primary-hover', 4.5)
  contrast('foreground', 'selection', 4.5)
  contrast('log-foreground', 'log-background', 4.5)

  // Light samples must stay light inside a dark app, and vice versa.
  const preview = document.createElement('span')
  preview.className = 'scheme-preview'
  preview.dataset.colorScheme = scheme
  preview.dataset.theme = mode
  document.body.append(preview)
  document.documentElement.dataset.theme = mode === 'dark' ? 'light' : 'dark'
  expect(getComputedStyle(preview).getPropertyValue('--background')).toBe(color('background'))
  expect(getComputedStyle(preview).getPropertyValue('--foreground')).toBe(color('foreground'))
})

it.each(combinations)('restores $scheme / $mode before app startup with matching browser chrome', ({ scheme, mode }) => {
  const run = new Function('localStorage', 'matchMedia', bootstrap)
  run({ getItem: (key: string) => key === 'local-repos:theme' ? mode : JSON.stringify({ colorScheme: scheme }) }, () => ({ matches: false }))
  expect(document.documentElement.dataset.colorScheme).toBe(scheme)
  expect(document.documentElement.dataset.theme).toBe(mode)
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
    .toBe(getComputedStyle(document.documentElement).getPropertyValue('--background').trim())
})

it.each(['{invalid', 'null', '[]', '{}', '{"colorScheme":"unknown"}', '{"colorScheme":"toString"}', '{"colorScheme":["ocean"]}'])('uses a safe scheme and system mode with legacy or malformed settings: %s', stored => {
  new Function('localStorage', 'matchMedia', bootstrap)(
    { getItem: (key: string) => key === 'local-repos:theme' ? null : stored }, () => ({ matches: true }),
  )
  expect(document.documentElement.dataset.colorScheme).toBe('forest')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('applies the default scheme and system mode when storage is blocked', () => {
  new Function('localStorage', 'matchMedia', bootstrap)(
    { getItem: () => { throw new Error('Storage blocked') } }, () => ({ matches: true }),
  )
  expect(document.documentElement.dataset.colorScheme).toBe('forest')
  expect(document.documentElement.dataset.theme).toBe('dark')
})
