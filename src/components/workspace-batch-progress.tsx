import { RemoteActivityBatchProgress } from '@/components/remote-activity-batch-progress'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { ReactDoctorBatchProgress } from '@/components/react-doctor-batch-progress'
import { LighthouseBatchProgress } from '@/components/lighthouse-batch-progress'
import type { useWorkspaceActions } from '@/hooks/use-workspace-actions'
import { projectActionLabel } from '@/lib/project-worktrees'
import type { RepoProject } from '@/types'

const emptyProjects: RepoProject[] = []

type Props = Pick<ReturnType<typeof useWorkspaceActions>, 'remoteActivityBatch' | 'previewBatch' | 'auditBatch' | 'outdatedBatch' | 'reactDoctorBatch' | 'lighthouseBatch'> & { projects?: RepoProject[] }

export function WorkspaceBatchProgress({ remoteActivityBatch, previewBatch, auditBatch, outdatedBatch, reactDoctorBatch, lighthouseBatch, projects = emptyProjects }: Props) {
  const names = new Map(projects.map(project => [project.id, projectActionLabel(project)]))
  const label = <T extends { id: string; name: string }>(project: T): T => ({ ...project, name: names.get(project.id) ?? project.name })
  const progress = <T extends { current?: Pick<RepoProject, 'id' | 'name'>; failures: { id: string; name: string; message: string }[] }>(value: T): T => ({ ...value, current: value.current ? label(value.current) : undefined, failures: value.failures.map(label) })
  return <>
    {remoteActivityBatch.progress && <RemoteActivityBatchProgress progress={progress(remoteActivityBatch.progress)} onStop={remoteActivityBatch.stop} onDismiss={remoteActivityBatch.dismiss} />}
    {previewBatch.progress && <PreviewBatchProgress progress={progress(previewBatch.progress)} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
    {auditBatch.progress && <AuditBatchProgress progress={progress(auditBatch.progress)} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
    {outdatedBatch.progress && <OutdatedBatchProgress progress={progress(outdatedBatch.progress)} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}
    {reactDoctorBatch.progress && <ReactDoctorBatchProgress progress={progress(reactDoctorBatch.progress)} onStop={reactDoctorBatch.stop} onDismiss={reactDoctorBatch.dismiss} />}
    {lighthouseBatch.progress && <LighthouseBatchProgress progress={progress(lighthouseBatch.progress)} onStop={lighthouseBatch.stop} onDismiss={lighthouseBatch.dismiss} />}
  </>
}
