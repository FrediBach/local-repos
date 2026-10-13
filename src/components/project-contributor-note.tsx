import { Heart } from 'lucide-react'
import { remoteRepository } from '@/lib/remote-activity'
import type { RepoProject } from '@/types'
import './project-contributor-note.css'

export function ProjectContributorNote({ project }: { project: RepoProject }) {
  const repository = remoteRepository(project)
  if (project.monorepo || repository?.url.toLowerCase() !== 'https://github.com/fredibach/local-repos') return null
  return <p className="project-contributor-note"><Heart size={15} aria-hidden="true" /><span>Thanks for contributing!</span></p>
}
