import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { defaultSettings, normalizeSettings, readSettings, SETTINGS_STORAGE_KEY, validateSettings, type AppSettings } from '@/lib/settings'

const SettingsContext = createContext({
  settings: defaultSettings,
  saveSettings: (_next: AppSettings): void => { throw new Error('Settings provider is missing.') },
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(readSettings)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY || event.key === null) setSettings(readSettings())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function saveSettings(next: AppSettings) {
    if (Object.keys(validateSettings(next)).length) throw new Error('Correct the invalid settings before saving.')
    const normalized = normalizeSettings(next)
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized)) }
    catch { throw new Error('Could not save settings in this browser. Check browser storage permissions and try again.') }
    setSettings(normalized)
  }
  return <SettingsContext.Provider value={{ settings, saveSettings }}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
