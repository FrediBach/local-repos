import { useId, useRef, type ReactNode } from 'react'

const tabs = ['overview', 'packages', 'readme'] as const
type ProjectTab = typeof tabs[number]
const labels = { overview: 'Overview', packages: 'Packages', readme: 'README' }

export function ProjectTabs({ value, onChange, children }: { value: ProjectTab; onChange: (tab: ProjectTab) => void; children: ReactNode }) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return <>
    <div className="detail-tabs" role="tablist" aria-label="Project details">
      {tabs.map((tab, index) => <button key={tab} ref={node => { buttons.current[index] = node }}
        type="button" role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`}
        aria-selected={value === tab} tabIndex={value === tab ? 0 : -1}
        className={value === tab ? 'active' : ''} onClick={() => onChange(tab)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
          if (next === undefined) return
          event.preventDefault()
          onChange(tabs[next])
          buttons.current[next]?.focus()
        }}>{labels[tab]}</button>)}
    </div>
    <div key={value} className="detail-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0}>{children}</div>
  </>
}
