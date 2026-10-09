import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultSettings, normalizeSettings, PREFERENCES_CHANGED_EVENT, readSettings, SETTINGS_STORAGE_KEY, validateSettings, type AppSettings } from '@/lib/settings'

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
    const onImport = () => setSettings(readSettings())
    window.addEventListener('storage', onStorage)
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onImport)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(PREFERENCES_CHANGED_EVENT, onImport) }
  }, [])

  const saveSettings = useCallback((next: AppSettings) => {
    if (Object.keys(validateSettings(next)).length) throw new Error('Correct the invalid settings before saving.')
    const normalized = normalizeSettings(next)
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized)) }
    catch { throw new Error('Could not save settings in this browser. Check browser storage permissions and try again.') }
    setSettings(normalized)
  }, [])
  const value = useMemo(() => ({ settings, saveSettings }), [settings, saveSettings])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
