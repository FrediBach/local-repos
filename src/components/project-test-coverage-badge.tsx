import { TestTubeDiagonal } from 'lucide-react'
import { coverageLevel, coveragePercent, formatCoveragePercent } from '@/lib/test-coverage'
import type { RepoProject } from '@/types'
import './project-test-coverage.css'

export function ProjectTestCoverageBadge({ project, onClick }: { project: RepoProject; onClick: () => void }) {
  const report = project.testCoverage
  if (!report) return null
  const label = `${project.name}: ${coveragePercent(report.metrics.lines) === null ? 'Line coverage unavailable' : `${formatCoveragePercent(report.metrics.lines)} line coverage`}${report.source === 'existing-report' ? ', imported report' : ''}${report.warning ? ', scan notes available' : ''}. View test coverage`
  const date = report.source === 'run' ? `Tests run: ${new Date(report.scannedAt).toLocaleString()}`
    : `Imported: ${new Date(report.scannedAt).toLocaleString()}\n${report.reportModifiedAt ? `Report modified: ${new Date(report.reportModifiedAt).toLocaleString()}` : 'Report age unknown'}`
  return <button type="button" className={`project-test-coverage-badge coverage-level-${coverageLevel(report.metrics.lines)}`}
    aria-label={label} title={`${label}\n${date}`} onClick={onClick}>
    <TestTubeDiagonal size={15} aria-hidden="true" /><span aria-hidden="true">{formatCoveragePercent(report.metrics.lines)}</span>
  </button>
}
