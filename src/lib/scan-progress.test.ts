import { describe, expect, it } from 'vitest'
import { projectScanProgress, type ActiveScanProgress } from './scan-progress'

const scan: ActiveScanProgress = { title: 'Individual scan', projectId: 'alpha', stage: { phase: 'Checking' }, stageStartedAt: 10, startedAt: 5 }
const batch = { title: 'Batch scan', progress: { current: { id: 'alpha' }, stage: { phase: 'Preparing' }, stageStartedAt: 0, startedAt: 0 } }

describe('selected project scan progress', () => {
  it('prefers the selected project’s individual scan over batch progress', () => {
    expect(projectScanProgress('alpha', 'Alpha', scan, [batch])).toBe(scan)
  })

  it('selects a matching batch when the individual scan belongs to another project', () => {
    expect(projectScanProgress('alpha', 'Alpha', { ...scan, projectId: 'beta' }, [batch])).toEqual({
      title: 'Batch scan', projectId: 'alpha', projectName: 'Alpha', stage: batch.progress.stage, stageStartedAt: 0, startedAt: 0,
    })
  })

  it('does not display another project’s progress or invent missing timing', () => {
    expect(projectScanProgress('beta', 'Beta', scan, [batch])).toBeUndefined()
    expect(projectScanProgress('alpha', 'Alpha', undefined, [{ ...batch, progress: { ...batch.progress, startedAt: undefined } }])).toBeUndefined()
    expect(projectScanProgress('alpha', 'Alpha', undefined, [{ ...batch, progress: { ...batch.progress, stageStartedAt: undefined } }])).toBeUndefined()
  })

  it('keeps batch priority and skips batches without a current stage', () => {
    const later = { ...batch, title: 'Later batch' }
    expect(projectScanProgress('alpha', 'Alpha', undefined, [batch, later])?.title).toBe('Batch scan')
    expect(projectScanProgress('alpha', 'Alpha', undefined, [{ ...batch, progress: { ...batch.progress, stage: undefined } }, later])?.title).toBe('Later batch')
  })
})
