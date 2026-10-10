import { History } from 'lucide-react'
import type { Workspace } from '@/types'

export function WorkspaceReportNote({ workspace }: { workspace?: Workspace }) {
  const hasUnknownReports = workspace?.projects.some(project => Object.values(project.reportState ?? {}).some(state => state?.validity === 'unknown'))
  if (!hasUnknownReports) return null

  return <p className="workspace-report-note" role="status">
    <History size={15} aria-hidden="true" />
    <span><strong>Cached reports.</strong> Some reports have unknown freshness after reconnecting. Rerun their scans to refresh them.</span>
  </p>
}
