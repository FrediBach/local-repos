import type { ScanProgress } from '@/types'

export interface ActiveScanProgress {
  title: string
  projectId?: string
  projectName?: string
  stage: ScanProgress
  stageStartedAt: number
  startedAt: number
}

interface BatchStage {
  title: string
  progress?: {
    current?: { id: string }
    stage?: ScanProgress
    stageStartedAt?: number
    startedAt?: number
  }
}

/** Prefer an individual scan, then the first matching batch with complete timing. */
export function projectScanProgress(projectId: string | undefined, projectName: string | undefined, scan: ActiveScanProgress | undefined, batches: readonly BatchStage[]): ActiveScanProgress | undefined {
  if (scan?.projectId === projectId) return scan
  const batch = batches.find(batch => batch.progress?.current?.id === projectId && batch.progress?.stage)
  const progress = batch?.progress
  if (!batch || !progress?.stage || progress.stageStartedAt === undefined || progress.startedAt === undefined) return undefined
  return { title: batch.title, projectId, projectName, stage: progress.stage, stageStartedAt: progress.stageStartedAt, startedAt: progress.startedAt }
}
