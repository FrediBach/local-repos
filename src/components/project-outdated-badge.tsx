import { ScanBadgeTooltip } from './scan-badge-tooltip'
import { PackageSearch } from 'lucide-react'
import { formatOutdatedScore } from '@/lib/outdated'
import type { RepoProject } from '@/types'

export function ProjectOutdatedBadge({ project, onClick }: { project: RepoProject; onClick: () => void }) {
  const report = project.outdated
  if (!report?.findings.length) return null
  const count = report.findings.length
  const score = formatOutdatedScore(report.score)
  const label = `${project.name}: ${count} outdated ${count === 1 ? 'package' : 'packages'}, update score ${score}. View outdated package details`

  return <ScanBadgeTooltip heading="Package updates" details={<>{count} outdated {count === 1 ? 'package' : 'packages'} · update score {score}</>} scannedAt={report.scannedAt}><button
    type="button"
    className={`project-outdated-badge outdated-level-${report.level}`}
    aria-label={label}
    onClick={onClick}
  ><PackageSearch size={15} aria-hidden="true" /><span aria-hidden="true">{score}</span></button></ScanBadgeTooltip>
}
