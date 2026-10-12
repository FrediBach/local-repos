import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import { DailySummary } from './daily-summary'
import { ProjectTodos } from './project-todos'
import type { ProjectTab } from './project-tabs'
import type { useProjectTodos } from '@/hooks/use-project-todos'
import { activeProjects } from '@/lib/workspace'
import type { RepoProject, Workspace } from '@/types'

interface Props {
  workspace?: Workspace
  workspaceStatus: 'loading' | 'ready' | 'error'
  page: 'projects' | 'summary' | 'todos'
  projects: RepoProject[]
  projectTodos: ReturnType<typeof useProjectTodos>
  todoProjectId?: string
  onClearProject: () => void
  onOpen: (project: RepoProject, tab?: ProjectTab) => void
  isDemo: boolean
  onConnect: () => void
  children: ReactNode
}

export function WorkspacePage({ workspace, workspaceStatus, page, projects, projectTodos, todoProjectId, onClearProject, onOpen, isDemo, onConnect, children }: Props) {
  if (!workspace && workspaceStatus !== 'ready') return <div className="empty-state" role="status">
    <Folder size={24} aria-hidden="true" />
    <h2>{workspaceStatus === 'loading' ? 'Loading saved workspace…' : 'Saved workspace could not be loaded.'}</h2>
    {workspaceStatus === 'error' && <p>Reload to try again, or connect a directory to browse this session.</p>}
  </div>
  if (page === 'todos') return <>
    {projectTodos.storageError && <p role="alert">Todo dismissals could not be saved in this browser. They will stay dismissed for this session.</p>}
    <ProjectTodos key={workspace ? `${workspace.mode}:${workspace.rootPath ?? workspace.rootName}` : 'demo'} projects={projects} todos={projectTodos.todos} projectId={todoProjectId} onClearProject={onClearProject} onOpen={onOpen} onDismiss={projectTodos.dismiss} isDemo={isDemo} onConnect={onConnect} />
  </>
  if (page === 'summary') return <DailySummary key={workspace?.rootPath ?? workspace?.rootName ?? 'demo'} projects={workspace ? activeProjects(workspace) : projects} helper={workspace?.mode === 'helper'} onConnect={onConnect} />
  return children
}
