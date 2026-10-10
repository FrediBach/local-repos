import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const allTabs = ['overview', 'history', 'development', 'packages', 'vulnerabilities', 'updates', 'unused', 'react-doctor', 'lighthouse', 'readme'] as const
export type ProjectTab = typeof allTabs[number]
const labels: Record<ProjectTab, string> = { overview: 'Overview', history: 'History', development: 'Development', packages: 'Packages', vulnerabilities: 'Vulnerabilities', updates: 'Updates', unused: 'Unused', 'react-doctor': 'React Doctor', lighthouse: 'Lighthouse', readme: 'README' }

export function ProjectTabs({ value, onChange, children, react = false, frontend = false }: { value: ProjectTab; onChange: (tab: ProjectTab) => void; children: ReactNode; react?: boolean; frontend?: boolean }) {
  const id = useId()
  const tablist = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [scrollable, setScrollable] = useState({ left: false, right: false })
  const tabs = allTabs.filter(tab => (tab !== 'react-doctor' || react) && (tab !== 'lighthouse' || frontend))

  function updateScrollControls() {
    const node = tablist.current
    if (node) setScrollable({ left: node.scrollLeft > 1, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 })
  }

  function revealSelectedTab() {
    buttons.current.find(button => button?.getAttribute('aria-selected') === 'true')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    updateScrollControls()
  }

  useEffect(() => {
    revealSelectedTab()
  }, [value, react, frontend])

  useEffect(() => {
    const node = tablist.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(revealSelectedTab)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  function scrollTabs(direction: number) {
    const node = tablist.current
    if (node) node.scrollBy({ left: direction * node.clientWidth * 0.75 })
  }

  return <>
    <div className="detail-navigation">
      <button type="button" className="detail-tab-scroll" aria-label="Scroll project tabs left" aria-controls={`${id}-tabs`} disabled={!scrollable.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={18} /></button>
      <div ref={tablist} id={`${id}-tabs`} className="detail-tabs" role="tablist" aria-label="Project details" onScroll={updateScrollControls}>
      {tabs.map((tab, index) => <button key={tab} ref={node => { buttons.current[index] = node }}
        type="button" role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`}
        aria-selected={value === tab} tabIndex={value === tab ? 0 : -1}
        className={value === tab ? 'active' : ''} onClick={() => onChange(tab)}
        onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
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
      <button type="button" className="detail-tab-scroll" aria-label="Scroll project tabs right" aria-controls={`${id}-tabs`} disabled={!scrollable.right} onClick={() => scrollTabs(1)}><ChevronRight size={18} /></button>
    </div>
    <div key={value} className="detail-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0}>{children}</div>
  </>
}
