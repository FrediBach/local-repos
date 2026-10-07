// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeControl } from './theme-control'

let dark = false
let media: EventTarget & { matches: boolean }
let saved: Map<string, string>
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> }

beforeEach(() => {
  dark = false
  saved = new Map()
  storage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value) }),
  }
  vi.stubGlobal('localStorage', storage)
  media = Object.assign(new EventTarget(), { get matches() { return dark } })
  Object.defineProperty(media, 'matches', { get: () => dark })
  vi.stubGlobal('matchMedia', vi.fn(() => media))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

function systemTheme(isDark: boolean) {
  act(() => { dark = isDark; media.dispatchEvent(new Event('change')) })
}

it('follows live system changes until an explicit theme is chosen, then remembers it', async () => {
  const user = userEvent.setup()
  const view = render(<ThemeControl />)
  const select = screen.getByRole('combobox', { name: 'Color theme' })
  expect(document.documentElement.dataset.theme).toBe('light')
  systemTheme(true)
  expect(document.documentElement.dataset.theme).toBe('dark')

  await user.selectOptions(select, 'light')
  systemTheme(false)
  systemTheme(true)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(saved.get('local-repos:theme')).toBe('light')

  view.unmount()
  render(<ThemeControl />)
  expect((screen.getByRole('combobox', { name: 'Color theme' }) as HTMLSelectElement).value).toBe('light')
  await user.selectOptions(screen.getByRole('combobox'), 'system')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('restores dark mode and synchronizes preference changes or clearing from another tab', () => {
  saved.set('local-repos:theme', 'dark')
  render(<ThemeControl />)
  expect(document.documentElement.dataset.theme).toBe('dark')
  act(() => {
    saved.set('local-repos:theme', 'light')
    window.dispatchEvent(new StorageEvent('storage', { key: 'local-repos:theme' }))
  })
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => {
    saved.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
  })
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('system')
  systemTheme(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('remains usable when browser storage is blocked', async () => {
  storage.getItem.mockImplementation(() => { throw new Error('Storage blocked') })
  storage.setItem.mockImplementation(() => { throw new Error('Storage blocked') })
  const user = userEvent.setup()
  render(<ThemeControl />)
  await user.selectOptions(screen.getByRole('combobox'), 'dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('ignores invalid saved preferences and releases system listeners on unmount', () => {
  saved.set('local-repos:theme', 'invalid')
  const view = render(<ThemeControl />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('system')
  view.unmount()
  systemTheme(true)
  expect(document.documentElement.dataset.theme).toBe('light')
})
