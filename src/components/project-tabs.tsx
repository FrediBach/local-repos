import { useId, useRef, type ReactNode } from 'react'

const allTabs = ['overview', 'packages', 'react-doctor', 'lighthouse', 'readme'] as const
export type ProjectTab = typeof allTabs[number]
const labels = { overview: 'Overview', packages: 'Packages', 'react-doctor': 'React Doctor', lighthouse: 'Lighthouse', readme: 'README' }

export function ProjectTabs({ value, onChange, children, react = false, frontend = false }: { value: ProjectTab; onChange: (tab: ProjectTab) => void; children: ReactNode; react?: boolean; frontend?: boolean }) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const tabs = allTabs.filter(tab => (tab !== 'react-doctor' || react) && (tab !== 'lighthouse' || frontend))
  return <>
    <div className={`detail-tabs${react ? ' react-doctor-tabs' : ''}${frontend ? ' lighthouse-tabs' : ''}`} role="tablist" aria-label="Project details">
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
