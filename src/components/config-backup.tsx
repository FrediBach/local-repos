import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { configFileSizeLimit, parseConfigBackup, type ConfigBackup, type ConfigImportResult } from '@/lib/config-backup'

export interface ConfigBackupControls {
  ready: boolean
  busy: boolean
  connected: boolean
  onExport: () => ConfigBackup
  onImport: (backup: ConfigBackup) => Promise<ConfigImportResult>
}

export function ConfigBackupPanel({ ready, busy, connected, onExport, onImport, onImported, onWorkingChange }: ConfigBackupControls & { onImported: (backup: ConfigBackup) => void; onWorkingChange: (working: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const disabled = !ready || busy || working

  function exportFile() {
    setError(''); setMessage('')
    try {
      const backup = onExport()
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `local-repos-config-${backup.exportedAt.slice(0, 10)}.json`
      document.body.append(link)
      try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Configuration exported.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not export the configuration.') }
  }

  async function importFile(file: File) {
    setWorking(true); onWorkingChange(true); setError(''); setMessage('')
    try {
      if (file.size > configFileSizeLimit) throw new Error('Choose a configuration file smaller than 5 MB.')
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('This file could not be read. Try selecting it again.'))
        reader.readAsText(file)
      })
      const backup = parseConfigBackup(text)
      const result = await onImport(backup)
      onImported(backup)
      setMessage(`Configuration imported. ${result.matched} project(s) matched; ${result.missing} missing, ${result.different} different, and ${result.ambiguous} ambiguous project(s) skipped. Existing favorites and tags were kept.${!connected && backup.projects.length ? ' Connect your directory and import this file again to restore its project preferences.' : ''}`)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not import the configuration.') }
    finally { setWorking(false); onWorkingChange(false) }
  }

  return <>
    <fieldset className="settings-section"><legend>Export configuration</legend>
      <p>Download your saved settings, color theme, favorites, and project tags as JSON. Save any pending settings changes before exporting.</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={exportFile}><Download size={15} />Export JSON</Button>
    </fieldset>
    <fieldset className="settings-section"><legend>Import configuration</legend>
      <p>Choose an export to apply its settings and theme immediately. Favorites and tags merge with your current projects. Missing projects, conflicting repositories, and uncertain matches are skipped; additional local projects keep their preferences.</p>
      <p>Connect the destination directory before importing project preferences. You can import the file again after adding missing repositories.</p>
      <input ref={input} type="file" accept=".json,application/json" aria-label="Configuration JSON file" hidden disabled={disabled} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importFile(file)
      }} />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}><Upload size={15} />{working ? 'Importing…' : 'Import JSON'}</Button>
    </fieldset>
    {!ready && <p className="config-backup-message">Saved preferences must finish loading before export or import is available. If loading failed, reload to try again.</p>}
    {busy && !working && <p className="config-backup-message">Wait for the current workspace action to finish.</p>}
    {error && <p role="alert" className="settings-save-error">{error}</p>}
    {message && <p role="status" className="config-backup-message">{message}</p>}
  </>
}
