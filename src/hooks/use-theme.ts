import { useEffect, useState } from 'react'
import { useSettings } from './use-settings'
import { PREFERENCES_CHANGED_EVENT } from '@/lib/settings'

export type ThemePreference = 'system' | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'local-repos:theme'

function validPreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function readThemePreference(): ThemePreference {
  try { return validPreference(localStorage.getItem(THEME_STORAGE_KEY)) } catch { return 'system' }
}

export function useTheme() {
  const { settings: { colorScheme } } = useSettings()
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.colorScheme = colorScheme
      const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
      if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
    }
    apply()
    media?.addEventListener('change', apply)
    return () => media?.removeEventListener('change', apply)
  }, [theme, colorScheme])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setTheme(readThemePreference())
    }
    const onImport = () => setTheme(readThemePreference())
    window.addEventListener('storage', onStorage)
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onImport)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(PREFERENCES_CHANGED_EVENT, onImport) }
  }, [])

  function changeTheme(next: ThemePreference) {
    setTheme(next)
    try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* Keep the preference for this session when storage is blocked. */ }
  }

  return { theme, changeTheme }
}
