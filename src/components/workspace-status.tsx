import { WorkspaceReportNote } from './workspace-report-note'
import { ScanProgressPanel } from './scan-progress-panel'
import type { ActiveScanProgress } from '@/lib/scan-progress'
import type { HelperActivity, Workspace } from '@/types'

interface Props {
  operations: HelperActivity[]
  error?: string
  workspace?: Workspace
  showReportNote: boolean
  scanProgress?: ActiveScanProgress
}

export function WorkspaceStatus({ operations, error, workspace, showReportNote, scanProgress }: Props) {
  return <>
    {operations.length > 0 && <p role="status">Helper work: {operations.map(operation => operation.progress?.phase ?? operation.kind).join(', ')}</p>}
    {error && <p role="status">{error}</p>}
    {showReportNote && <WorkspaceReportNote workspace={workspace} />}
    {scanProgress && <ScanProgressPanel progress={scanProgress} />}
  </>
}
