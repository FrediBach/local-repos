import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { colorSchemes } from '@/lib/color-schemes'
import type { AppSettings, NumericSettingKey, validateSettings } from '@/lib/settings'

interface Props {
  id: string
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  submitted: boolean
  errors: ReturnType<typeof validateSettings>
  field: (key: NumericSettingKey, hint?: string) => ReactNode
  onEdit: () => void
}

export function SettingsInterface({ id, draft, setDraft, submitted, errors, field, onEdit }: Props) {
  return <>
    <fieldset className="settings-section"><legend>Global commit heatmap</legend>
      <div className="settings-field"><label htmlFor={`${id}-commitActivityAuthor`}>Author email (optional)</label>
        <input id={`${id}-commitActivityAuthor`} type="text" value={draft.commitActivityAuthor} maxLength={1024} placeholder="All authors" autoComplete="off" spellCheck={false}
          aria-invalid={!!(submitted && errors.commitActivityAuthor)} aria-describedby={`${id}-commitActivityAuthor-hint`}
          onChange={event => { setDraft(current => ({ ...current, commitActivityAuthor: event.target.value })); onEdit() }} />
        <small id={`${id}-commitActivityAuthor-hint`} className={submitted && errors.commitActivityAuthor ? 'settings-field-error' : ''}>{submitted && errors.commitActivityAuthor || 'Leave blank for all authors, or enter the exact Git author email. Saving refreshes the heatmap when connected to the local helper.'}</small>
      </div>
    </fieldset>
    <fieldset className="settings-section" aria-describedby={`${id}-scheme-hint`}><legend>Color scheme</legend>
      <p id={`${id}-scheme-hint`}>Make this space your own. Every scheme works with the System, Light, and Dark modes in the top bar.</p>
      <div className="scheme-options">{colorSchemes.map(scheme => <label className="scheme-option" key={scheme.id}>
        <span className="scheme-option-heading"><input type="radio" name="colorScheme" value={scheme.id} checked={draft.colorScheme === scheme.id}
          aria-labelledby={`${id}-scheme-${scheme.id}`} aria-describedby={`${id}-scheme-${scheme.id}-description`}
          onChange={() => { setDraft(current => ({ ...current, colorScheme: scheme.id })); onEdit() }} />
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
          onChange={event => { setDraft(current => ({ ...current, pushReminderTime: event.target.value })); onEdit() }} />
        <small id={`${id}-pushReminderTime-hint`} className={submitted && errors.pushReminderTime ? 'settings-field-error' : ''}>{submitted && errors.pushReminderTime || `Your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}</small>
      </div>
      <p>While the app is open, the local helper checks for unpushed commits and uncommitted changes at this time and every five minutes afterward. Returning to the app later that day also triggers the check. Dismiss the reminder to silence it for today.</p>
      <p>Uses locally known origin branches. Fetch origin if needed for an up-to-date comparison. Browser folder connections cannot check push status.</p>
    </fieldset>
    <fieldset className="settings-section"><legend>Refresh & notifications</legend><div className="settings-grid">{field('statusPollSeconds', 'While development servers are running.')}{field('notificationSeconds', '0 = keep notifications until dismissed. Errors always stay visible.')}</div></fieldset>
  </>
}
