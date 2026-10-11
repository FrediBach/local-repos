import { RemoteActivityBatchProgress } from '@/components/remote-activity-batch-progress'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { ReactDoctorBatchProgress } from '@/components/react-doctor-batch-progress'
import { LighthouseBatchProgress } from '@/components/lighthouse-batch-progress'
import type { useWorkspaceActions } from '@/hooks/use-workspace-actions'

type Props = Pick<ReturnType<typeof useWorkspaceActions>, 'remoteActivityBatch' | 'previewBatch' | 'auditBatch' | 'outdatedBatch' | 'reactDoctorBatch' | 'lighthouseBatch'>

export function WorkspaceBatchProgress({ remoteActivityBatch, previewBatch, auditBatch, outdatedBatch, reactDoctorBatch, lighthouseBatch }: Props) {
  return <>
    {remoteActivityBatch.progress && <RemoteActivityBatchProgress progress={remoteActivityBatch.progress} onStop={remoteActivityBatch.stop} onDismiss={remoteActivityBatch.dismiss} />}
    {previewBatch.progress && <PreviewBatchProgress progress={previewBatch.progress} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
    {auditBatch.progress && <AuditBatchProgress progress={auditBatch.progress} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
    {outdatedBatch.progress && <OutdatedBatchProgress progress={outdatedBatch.progress} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}
    {reactDoctorBatch.progress && <ReactDoctorBatchProgress progress={reactDoctorBatch.progress} onStop={reactDoctorBatch.stop} onDismiss={reactDoctorBatch.dismiss} />}
    {lighthouseBatch.progress && <LighthouseBatchProgress progress={lighthouseBatch.progress} onStop={lighthouseBatch.stop} onDismiss={lighthouseBatch.dismiss} />}
  </>
}
