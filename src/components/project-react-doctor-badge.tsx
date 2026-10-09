import { Stethoscope } from 'lucide-react'
import { isReactProject, reactDoctorScoreLevel } from '@/lib/react-doctor'
import type { RepoProject } from '@/types'
import './project-react-doctor.css'

export function ProjectReactDoctorBadge({ project, onClick }: { project: RepoProject; onClick: () => void }) {
  const report = project.reactDoctor
  if (!report || !isReactProject(project)) return null
  const score = report.score === null ? 'Score unavailable' : `score ${report.score} out of 100`
  const label = `${project.name}: React Doctor ${score}${report.warning ? ', scan notes available' : ''}. View React Doctor findings`

  return <button type="button" className={`project-react-doctor-badge react-doctor-level-${reactDoctorScoreLevel(report.score)}`}
    aria-label={label} title={`${label}\n${report.label}\nLast scan: ${new Date(report.scannedAt).toLocaleString()}`} onClick={onClick}>
    <Stethoscope size={15} aria-hidden="true" /><span aria-hidden="true">{report.score ?? '—'}</span>
  </button>
}
