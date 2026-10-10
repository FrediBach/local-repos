import { Gauge } from 'lucide-react'
import { lighthousePerformanceScore, lighthouseScoreLevel } from '@/lib/lighthouse'
import type { RepoProject } from '@/types'
import './project-react-doctor.css'
import './project-lighthouse.css'

export function ProjectLighthouseBadge({ project, onClick }: { project: RepoProject; onClick: () => void }) {
  const report = project.lighthouse
  if (!report) return null
  const score = lighthousePerformanceScore(report)
  const label = `${project.name}: Lighthouse performance ${score === null ? 'score unavailable' : `score ${score} out of 100`}${report.warnings.length ? ', scan notes available' : ''}. View Lighthouse analysis`
  return <button type="button" className={`project-lighthouse-badge react-doctor-level-${lighthouseScoreLevel(score)}`} aria-label={label} title={`${label}\nLast scan: ${new Date(report.scannedAt).toLocaleString()}`} onClick={onClick}>
    <Gauge size={15} aria-hidden="true" /><span aria-hidden="true">Perf {score ?? '—'}</span>
  </button>
}
