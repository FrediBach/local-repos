import { useId, useRef, useState } from 'react'
import { RotateCcw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useSettings } from '@/hooks/use-settings'
import { auditSeverities, badgeColors, defaultSettings, normalizeSettings, numericSettings, validateSettings, type BadgeColor, type NumericSettingKey, type WatcherMode } from '@/lib/settings'
import { formatOutdatedScore, outdatedLevel, scoreVersionGap } from '@/lib/outdated'
import './settings-dialog.css'

const tabs = ['badges', 'filters', 'watcher', 'interface'] as const
type SettingsTab = typeof tabs[number]
const labels = { badges: 'Badges & scores', filters: 'Filter thresholds', watcher: 'Watcher', interface: 'Interface' }
const fieldTabs = (key: NumericSettingKey): SettingsTab => key.startsWith('watcher') ? 'watcher' : key.includes('Activity') || key === 'largeProjectGiB' || key === 'heavyNodeModulesMiB' ? 'filters' : key.endsWith('Limit') || key.endsWith('Seconds') ? 'interface' : 'badges'

export function SettingsDialog() {
  const { settings, saveSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [tab, setTab] = useState<SettingsTab>('badges')
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState('')
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const errors = validateSettings(draft)
  const preview = normalizeSettings(draft)
  const field = (key: NumericSettingKey, hint?: string) => {
    const { label, min, max, step } = numericSettings[key]
    const error = submitted && errors[key]
    return <div className="settings-field" key={key}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} name={key} type="number" min={min} max={max} step={step} value={Number.isNaN(draft[key]) ? '' : draft[key]}
        aria-invalid={!!error} aria-describedby={error || hint ? `${id}-${key}-hint` : undefined}
        onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value === '' ? NaN : event.target.valueAsNumber })); setSaveError('') }} />
      {(error || hint) && <small id={`${id}-${key}-hint`} className={error ? 'settings-field-error' : ''}>{error || hint}</small>}
    </div>
  }

  function changeOpen(value: boolean) {
    if (value) { setDraft({ ...settings, auditColors: { ...settings.auditColors } }); setTab('badges'); setSubmitted(false); setSaveError('') }
    setOpen(value)
  }

  function save() {
    setSubmitted(true)
    const firstError = Object.keys(errors)[0] as NumericSettingKey | undefined
    if (firstError) { setTab(fieldTabs(firstError)); return }
    try { saveSettings(draft); setOpen(false) }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save settings.') }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className="workspace-info-button settings-trigger" aria-label="Settings" title="Settings"><Settings size={17} /></button></DialogTrigger>
    <DialogContent className="settings-dialog">
      <div className="settings-header"><DialogTitle><Settings size={20} />Settings</DialogTitle><DialogDescription>Badge rules, filter thresholds, and workspace preferences.</DialogDescription></div>
      <form noValidate onSubmit={event => { event.preventDefault(); save() }}>
        <div className="settings-tabs" role="tablist" aria-label="Settings categories">
          {tabs.map((value, index) => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
            ref={node => { buttons.current[index] = node }} onClick={() => setTab(value)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault(); setTab(tabs[next]); buttons.current[next]?.focus()
            }}>{labels[value]}</button>)}
        </div>
        <div className="settings-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0} key={tab}>
          {tab === 'badges' && <>
            <fieldset className="settings-section"><legend>Vulnerability colors</legend><p>The project badge uses the highest reported severity. Severity labels and counts stay as reported by the package manager.</p>
              <div className="settings-color-grid">{auditSeverities.map(severity => <label className="settings-field" key={severity}>
                <span className="settings-severity"><i className={`audit-color-${draft.auditColors[severity]}`} aria-hidden="true" />{severity}</span>
                <select aria-label={`${severity[0].toUpperCase()}${severity.slice(1)} severity color`} value={draft.auditColors[severity]} onChange={event => setDraft(current => ({ ...current, auditColors: { ...current.auditColors, [severity]: event.target.value as BadgeColor } }))}>
                  {badgeColors.map(color => <option key={color} value={color}>{color[0].toUpperCase()}{color.slice(1)}</option>)}
                </select>
              </label>)}</div>
            </fieldset>
            <fieldset className="settings-section"><legend>Outdated package colors</legend><p>Package lag measures version gaps, not release age in days. Red requires both the score and major-version thresholds.</p>
              <div className="settings-grid">{field('outdatedOrangeScore')}{field('outdatedRedScore')}{field('outdatedRedMajorGap', '0 = score only.')}</div>
              <label className="settings-checkbox"><input type="checkbox" checked={draft.majorUpdatesAreOrange} onChange={event => setDraft(current => ({ ...current, majorUpdatesAreOrange: event.target.checked }))} />Any major update is at least orange</label>
              <div className="settings-preview" aria-label="Package badge preview"><span>Preview</span>{[
                ['Patch +3', '1.0.3'], ['Major +1', '2.0.0'], ['Major +10', '11.0.0'],
              ].map(([label, latest]) => {
                const gap = scoreVersionGap('1.0.0', latest, preview)!
                return <span key={label} className={`settings-example outdated-level-${outdatedLevel([gap], preview)}`}>{label}<strong>{formatOutdatedScore(gap.score)}</strong></span>
              })}</div>
              <details className="settings-advanced" open={submitted && ['majorVersionPoints', 'minorVersionPoints', 'minorVersionCap', 'patchVersionPoints', 'patchVersionCap', 'prereleasePoints'].some(key => !!errors[key as NumericSettingKey]) || undefined}>
                <summary>Score weights</summary><p>Only the highest changed version component contributes for each package. Package scores are then summed.</p>
                <div className="settings-grid">{field('majorVersionPoints')}{field('prereleasePoints')}{field('minorVersionPoints')}{field('minorVersionCap')}{field('patchVersionPoints')}{field('patchVersionCap')}</div>
              </details>
            </fieldset>
          </>}
          {tab === 'filters' && <>
            <fieldset className="settings-section"><legend>Project activity</legend><p>Adjust the four Last activity filter windows. Values must increase from recent to long inactive.</p><div className="settings-grid">{field('recentActivityDays')}{field('activeActivityDays')}{field('inactiveActivityDays')}{field('dormantActivityDays')}</div></fieldset>
            <fieldset className="settings-section"><legend>Disk usage</legend><p>Thresholds for the large-project and large-node_modules filters.</p><div className="settings-grid">{field('largeProjectGiB')}{field('heavyNodeModulesMiB')}</div></fieldset>
          </>}
          {tab === 'interface' && <>
            <fieldset className="settings-section"><legend>Project display</legend><div className="settings-grid">{field('sidebarTechnologyLimit')}{field('projectTagLimit', '0 = hide technology tags.')}{field('packageMatchLimit')}</div></fieldset>
            <fieldset className="settings-section"><legend>Refresh & notifications</legend><div className="settings-grid">{field('statusPollSeconds', 'While development servers are running.')}{field('notificationSeconds', '0 = keep notifications until dismissed. Errors always stay visible.')}</div></fieldset>
          </>}
          {tab === 'watcher' && <>
            <fieldset className="settings-section"><legend>Rescan your workspace</legend>
              <p>Automatic scans run while this app is open and online. They wait for other actions to finish. Manual scan buttons remain available in every mode.</p>
              <label className="settings-field"><span>Scan mode</span><select value={draft.watcherMode} onChange={event => setDraft(current => ({ ...current, watcherMode: event.target.value as WatcherMode }))}>
                <option value="manual">Only when I initiate a scan</option><option value="periodic">Periodically</option><option value="changes">When a package changes</option>
              </select></label>
              {draft.watcherMode === 'manual' ? <p className="watcher-hint">No automatic rescans, including when you reopen the app. Use Synced, Scan vulnerabilities, or Scan outdated packages to refresh results.</p> : <div className="settings-grid watcher-hint">{draft.watcherMode === 'periodic' ? field('watcherIntervalMinutes', 'The first scan runs after this interval. All projects are included, even when filtered.') : field('watcherPollSeconds', 'Watches package manifests, workspace declarations, and lockfiles in known projects. Only affected repositories are checked; new projects are discovered on resync.')}</div>}
            </fieldset>
            <fieldset className="settings-section"><legend>Include in automatic scans</legend>
              <p>Project metadata and package declarations are always refreshed. Additional checks require the local helper. Vulnerability and outdated checks contact your configured package registries.</p>
              {([['watcherAudit', 'Vulnerabilities'], ['watcherOutdated', 'Outdated packages'], ['watcherStorage', 'Disk usage']] as const).map(([key, label]) => <label className="settings-checkbox" key={key}><input type="checkbox" checked={draft[key]} disabled={draft.watcherMode === 'manual'} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
              <p className="watcher-hint">Package-change watching requires the local helper. Browser directory connections support periodic metadata scans while read permission is granted. Automatic scans never install or update packages.</p>
            </fieldset>
          </>}
        </div>
        <div className="settings-footer">
          {(saveError || submitted && Object.keys(errors).length > 0) && <p role="alert" className="settings-save-error">{saveError || 'Correct the highlighted values before saving.'}</p>}
          <div className="settings-footer-actions"><Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ ...defaultSettings, auditColors: { ...defaultSettings.auditColors } }); setSubmitted(false); setSaveError('') }}><RotateCcw size={14} />Reset defaults</Button><div><Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" size="sm">Save settings</Button></div></div>
          <p>Saved in this browser. Changes apply immediately after saving.</p>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
