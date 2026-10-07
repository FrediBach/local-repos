import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from '@/hooks/use-theme'

export function ThemeControl() {
  const { theme, changeTheme } = useTheme()
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  return <label className="theme-control">
    <Icon size={17} aria-hidden="true" />
    <span className="sr-only">Color theme</span>
    <select value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
}
