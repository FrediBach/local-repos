import { ChevronDown, History } from 'lucide-react'
import type { Workspace } from '@/types'

export function WorkspaceReportNote({ workspace, compact = false }: { workspace?: Workspace; compact?: boolean }) {
  const hasUnknownReports = workspace?.projects.some(project => Object.values(project.reportState ?? {}).some(state => state?.validity === 'unknown'))
  if (!hasUnknownReports) return null

  if (compact) return <details className="workspace-report-disclosure" onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }
  }}>
    <summary><History size={14} aria-hidden="true" /><span>Cached reports</span><ChevronDown size={12} aria-hidden="true" /></summary>
    <p>Some reports have unknown freshness after reconnecting. Rerun their scans to refresh them.</p>
  </details>

  return <p className="workspace-report-note" role="status">
    <History size={15} aria-hidden="true" />
    <span><strong>Cached reports.</strong> Some reports have unknown freshness after reconnecting. Rerun their scans to refresh them.</span>
  </p>
}
