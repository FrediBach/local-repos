import { Bot } from 'lucide-react'
import type { RepoProject } from '@/types'

export function ProjectAiBadge({ project }: { project: RepoProject }) {
  if (!project.aiInstructionFiles?.length) return null

  return <span
    className="project-ai-badge"
    role="img"
    aria-label={`${project.name}: developed with AI`}
    title={`Developed with AI\nRoot files: ${project.aiInstructionFiles.join(', ')}`}
  ><Bot size={16} aria-hidden="true" /></span>
}
