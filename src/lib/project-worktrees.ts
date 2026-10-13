import type { GitRepository, GitWorktree, RepoProject } from '@/types'

export function projectRepository(project: RepoProject, repositories: readonly GitRepository[] = []): GitRepository | undefined {
  const context = project.gitContext
  return context?.state === 'verified' ? repositories.find(repository => repository.id === context.repositoryId) : undefined
}

export function hasWorktreeDetails(project: RepoProject, repository?: GitRepository): boolean {
  const context = project.gitContext
  return context?.state === 'unresolved' || context?.state === 'verified' && (context.role === 'linked' || !repository || repository.status !== 'complete' || repository.worktrees.filter(worktree => worktree.role !== 'bare').length > 1)
}

export function projectBranchLabel(project: RepoProject): string {
  const branch = project.git?.branch
  if (branch === 'Detached HEAD') return `Detached HEAD${project.git?.commit ? ` · ${project.git.commit.slice(0, 7)}` : ''}`
  return branch ?? (project.gitContext || project.git ? 'Branch unavailable' : 'No Git branch')
}

/** Keep action targets distinguishable even when manifests use the same name. */
export function projectActionLabel(project: RepoProject, name = project.name): string {
  return project.gitContext?.state === 'verified' ? `${name} · ${projectBranchLabel(project)} · ${project.relativePath}` : name
}

export function worktreeCountLabel(repository?: GitRepository): string {
  if (!repository) return 'Worktrees'
  const count = repository.worktrees.filter(worktree => worktree.role !== 'bare').length
  return repository.status === 'unavailable' ? 'Worktrees · cached' : `Worktrees ${count}${repository.status === 'partial' ? '+' : ''}`
}

export function worktreeBranchLabel(worktree: GitWorktree): string {
  if (worktree.role === 'bare') return 'Bare repository'
  if (worktree.detached) return `Detached HEAD${worktree.head ? ` · ${worktree.head.slice(0, 7)}` : ''}`
  return `${worktree.branch ?? 'Branch unavailable'}${worktree.unborn ? ' · no commits yet' : ''}`
}

const projectPath = (path: string) => path === '.' ? '' : path

/** Navigation never fabricates a project or crosses an inventory boundary. */
export function worktreeNavigation(source: RepoProject, worktree: GitWorktree, projects: readonly RepoProject[], ignoredIds: ReadonlySet<string> = new Set()) {
  if (worktree.availability !== 'available' || worktree.role === 'bare' || source.gitContext?.state !== 'verified') return
  const context = source.gitContext
  const candidates = projects.filter(project => !ignoredIds.has(project.id) && project.gitContext?.state === 'verified' && project.gitContext.repositoryId === context.repositoryId && project.gitContext.worktreeId === worktree.id)
  const path = projectPath(context.projectPath)
  const counterpart = path ? candidates.find(project => project.gitContext?.state === 'verified' && projectPath(project.gitContext.projectPath) === path) : undefined
  if (counterpart) return { project: counterpart, label: 'View package', packagePath: path }
  const root = candidates.find(project => project.id === worktree.projectId && project.gitContext?.state === 'verified' && !projectPath(project.gitContext.projectPath))
  if (root) return { project: root, label: 'View checkout', missingPackage: path || undefined }
}
