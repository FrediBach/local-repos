import { useEffect, useState } from 'react'
import { useSettings } from './use-settings'

export type ThemePreference = 'system' | 'light' | 'dark'
const storageKey = 'local-repos:theme'

function validPreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function readPreference(): ThemePreference {
  try { return validPreference(localStorage.getItem(storageKey)) } catch { return 'system' }
}

export function useTheme() {
  const { settings: { colorScheme } } = useSettings()
  const [theme, setTheme] = useState<ThemePreference>(readPreference)

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
      if (event.key === storageKey || event.key === null) setTheme(readPreference())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function changeTheme(next: ThemePreference) {
    setTheme(next)
    try { localStorage.setItem(storageKey, next) } catch { /* Keep the preference for this session when storage is blocked. */ }
  }

  return { theme, changeTheme }
}
