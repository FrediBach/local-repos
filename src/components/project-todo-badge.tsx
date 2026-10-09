import { ListTodo } from 'lucide-react'
import type { RepoProject } from '@/types'
import './project-todo-badge.css'

export function ProjectTodoBadge({ project, count, onClick }: { project: RepoProject; count: number; onClick: () => void }) {
  if (!count) return null
  const label = `${project.name}: ${count} ${count === 1 ? 'todo' : 'todos'}. View todos`
  return <button type="button" className="project-todo-badge" aria-label={label} title={label} onClick={onClick}>
    <ListTodo size={14} aria-hidden="true" /><span aria-hidden="true">{count}</span>
  </button>
}
