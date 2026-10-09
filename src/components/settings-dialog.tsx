import { useId, useRef, useState, type Ref } from 'react'
import { RotateCcw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useSettings } from '@/hooks/use-settings'
import { auditSeverities, badgeColors, defaultSettings, normalizeSettings, numericSettings, validateSettings, type BadgeColor, type NumericSettingKey, type SettingsErrorKey, type WatcherMode } from '@/lib/settings'
import { formatOutdatedScore, outdatedLevel, scoreVersionGap } from '@/lib/outdated'
import { colorSchemes } from '@/lib/color-schemes'
import { desktopPlatforms, editors, gitClients, terminals, type TerminalId, type EditorId, type GitClientId } from '@/lib/desktop-apps'
import { ConfigBackupPanel, type ConfigBackupControls } from './config-backup'
import './settings-dialog.css'

const tabs = ['badges', 'filters', 'watcher', 'interface', 'applications', 'backup'] as const
type SettingsTab = typeof tabs[number]
const labels = { badges: 'Badges & scores', filters: 'Filter thresholds', watcher: 'Watcher', interface: 'Interface', applications: 'Applications', backup: 'Backup' }
const fieldTabs = (key: SettingsErrorKey): SettingsTab => key === 'pushReminderTime' ? 'interface' : key.startsWith('watcher') ? 'watcher' : key.includes('Activity') || key === 'largeProjectGiB' || key === 'heavyNodeModulesMiB' ? 'filters' : key.endsWith('Limit') || key.endsWith('Seconds') ? 'interface' : 'badges'

export function SettingsDialog({ backup, triggerRef }: { backup: ConfigBackupControls; triggerRef?: Ref<HTMLButtonElement> }) {
  const { settings, saveSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [tab, setTab] = useState<SettingsTab>('badges')
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [transferring, setTransferring] = useState(false)
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
    if (transferring) return
    if (value) { setDraft({ ...settings, auditColors: { ...settings.auditColors } }); setTab('badges'); setSubmitted(false); setSaveError('') }
    setOpen(value)
  }

  function save() {
    setSubmitted(true)
    const firstError = Object.keys(errors)[0] as SettingsErrorKey | undefined
    if (firstError) { setTab(fieldTabs(firstError)); return }
    try { saveSettings(draft); setOpen(false) }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save settings.') }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button ref={triggerRef} type="button" className="workspace-info-button settings-trigger" aria-label="Settings" title="Settings"><Settings size={17} /></button></DialogTrigger>
    <DialogContent className="settings-dialog">
      <div className="settings-header"><DialogTitle><Settings size={20} />Settings</DialogTitle><DialogDescription>Appearance, badge rules, and workspace preferences.</DialogDescription></div>
      <form noValidate onSubmit={event => { event.preventDefault(); save() }}>
        <div className="settings-tabs" role="tablist" aria-label="Settings categories">
          {tabs.map((value, index) => <button key={value} type="button" role="tab" disabled={transferring} id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
            ref={node => { buttons.current[index] = node }} onClick={() => setTab(value)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault(); setTab(tabs[next]); buttons.current[next]?.focus()
            }}>{labels[value]}</button>)}
        </div>
        <div className="settings-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0} key={tab}>
          {tab === 'backup' && <ConfigBackupPanel {...backup} onWorkingChange={setTransferring} onImported={value => { setDraft(value.settings); setSubmitted(false); setSaveError('') }} />}
          {tab === 'applications' && <fieldset className="settings-section"><legend>Open projects with</legend>
            <p>Choose the editor and Git client for project menus and detail buttons, and the terminal for running scripts. Applications must be installed on the computer running the local helper.</p>
            <div className="settings-grid">
              <label className="settings-field"><span>Code editor</span><select value={draft.editor} onChange={event => { setDraft(current => ({ ...current, editor: event.target.value as EditorId })); setSaveError('') }}>
                {editors.map(app => <option key={app.id} value={app.id}>{app.name}{app.platforms.length < 3 ? ` (${app.platforms.map(platform => desktopPlatforms[platform]).join(', ')})` : ''}</option>)}
              </select></label>
              <label className="settings-field"><span>Git client</span><select value={draft.gitClient} onChange={event => { setDraft(current => ({ ...current, gitClient: event.target.value as GitClientId })); setSaveError('') }}>
                {gitClients.map(app => <option key={app.id} value={app.id}>{app.name}{app.platforms.length < 3 ? ` (${app.platforms.map(platform => desktopPlatforms[platform]).join(', ')})` : ''}</option>)}
              </select></label>
              <label className="settings-field"><span>Script terminal</span><select value={draft.terminal} onChange={event => { setDraft(current => ({ ...current, terminal: event.target.value as TerminalId })); setSaveError('') }}>
                {terminals.map(app => <option key={app.id} value={app.id}>{app.name} ({app.platforms.map(platform => desktopPlatforms[platform]).join(', ')})</option>)}
              </select></label>
            </div>
            <p className="watcher-hint">Automatic uses Terminal on macOS or an available Linux terminal. Script launching requires macOS or Linux. Opening applications requires a local helper connection. On Linux, enable the application's command-line launcher. On Windows, add its executable folder to PATH. Restart the helper after changing PATH.</p>
          </fieldset>}
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
            <fieldset className="settings-section" aria-describedby={`${id}-scheme-hint`}><legend>Color scheme</legend>
              <p id={`${id}-scheme-hint`}>Make this space your own. Every scheme works with the System, Light, and Dark modes in the top bar.</p>
              <div className="scheme-options">{colorSchemes.map(scheme => <label className="scheme-option" key={scheme.id}>
                <span className="scheme-option-heading"><input type="radio" name="colorScheme" value={scheme.id} checked={draft.colorScheme === scheme.id}
                  aria-labelledby={`${id}-scheme-${scheme.id}`} aria-describedby={`${id}-scheme-${scheme.id}-description`}
                  onChange={() => { setDraft(current => ({ ...current, colorScheme: scheme.id })); setSaveError('') }} />
                  <strong id={`${id}-scheme-${scheme.id}`}>{scheme.name}</strong>
                </span>
                <span className="scheme-description" id={`${id}-scheme-${scheme.id}-description`}>{scheme.description}</span>
                <span className="scheme-preview-pair" aria-hidden="true">{(['light', 'dark'] as const).map(mode => <span className="scheme-preview" data-color-scheme={scheme.id} data-theme={mode} key={mode}>
                  <span className="scheme-preview-sidebar"><i /><i /><i /></span>
                  <span className="scheme-preview-content"><span>{mode === 'light' ? 'Light' : 'Dark'}</span><i /><b /></span>
                </span>)}</span>
              </label>)}</div>
            </fieldset>
            <fieldset className="settings-section"><legend>Project display</legend><div className="settings-grid">{field('sidebarTechnologyLimit')}{field('projectTagLimit', '0 = hide technology tags.')}{field('packageMatchLimit')}</div></fieldset>
            <fieldset className="settings-section"><legend>End-of-day push reminder</legend>
              <label className="settings-checkbox"><input type="checkbox" checked={draft.pushReminderEnabled} onChange={event => setDraft(current => ({ ...current, pushReminderEnabled: event.target.checked }))} />Remind me to push changes to origin</label>
              <div className="settings-field"><label htmlFor={`${id}-pushReminderTime`}>Reminder time</label>
                <input id={`${id}-pushReminderTime`} type="time" value={draft.pushReminderTime} disabled={!draft.pushReminderEnabled}
                  aria-invalid={!!(submitted && errors.pushReminderTime)} aria-describedby={`${id}-pushReminderTime-hint`}
                  onChange={event => { setDraft(current => ({ ...current, pushReminderTime: event.target.value })); setSaveError('') }} />
                <small id={`${id}-pushReminderTime-hint`} className={submitted && errors.pushReminderTime ? 'settings-field-error' : ''}>{submitted && errors.pushReminderTime || `Your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}</small>
              </div>
              <p>While the app is open, the local helper checks for unpushed commits and uncommitted changes at this time and every five minutes afterward. Returning to the app later that day also triggers the check. Dismiss the reminder to silence it for today.</p>
              <p>Uses locally known origin branches. Fetch origin if needed for an up-to-date comparison. Browser folder connections cannot check push status.</p>
            </fieldset>
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
        {tab === 'backup' ? <div className="settings-footer"><Button type="button" variant="outline" size="sm" disabled={transferring} onClick={() => changeOpen(false)}>Close</Button><p>Backups contain preferences and repository identifiers. Project files, previews, and scan results stay on this device.</p></div> : <div className="settings-footer">
          {(saveError || submitted && Object.keys(errors).length > 0) && <p role="alert" className="settings-save-error">{saveError || 'Correct the highlighted values before saving.'}</p>}
          <div className="settings-footer-actions"><Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ ...defaultSettings, auditColors: { ...defaultSettings.auditColors } }); setSubmitted(false); setSaveError('') }}><RotateCcw size={14} />Reset defaults</Button><div><Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" size="sm">Save settings</Button></div></div>
          <p>Saved in this browser. Changes apply immediately after saving.</p>
        </div>}
      </form>
    </DialogContent>
  </Dialog>
}
