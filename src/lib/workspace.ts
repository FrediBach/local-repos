import { reportKinds, type RepoProject, type Workspace } from '@/types'

/** Older scans only grouped declared workspaces, so an omitted flag retains that meaning. */
export function isDeclaredWorkspaceMember(project: RepoProject): boolean {
  return !!project.monorepo && project.monorepo.declaredWorkspace !== false
}

/** Packages grouped by location may still install and maintain dependencies independently. */
export function packageWorkspaceId(project: RepoProject): string {
  return isDeclaredWorkspaceMember(project) ? project.monorepo!.id : project.id
}

/** Keep durable previews and dated maintenance results across helper restarts. */
export function preservePreviews(next: Workspace, previous?: Workspace): Workspace {
  if (!previous) return next
  const saved = new Map(previous.projects.map(project => [project.id, project]))
  return { ...next, projects: next.projects.map(project => {
    const cached = saved.get(project.id)
    if (!cached) return project
    const merged: RepoProject = { ...project, reportState: { ...cached.reportState, ...project.reportState } }
    for (const kind of reportKinds) {
      const incoming = project.reportState?.[kind]
      const previousState = cached.reportState?.[kind]
      const sameBoot = incoming?.helperInstanceId === previousState?.helperInstanceId
      // Missing data never revokes a dated success. Explicit tombstones do.
      if (previousState && (!incoming || (sameBoot && previousState.revision > incoming.revision))) {
        Object.assign(merged, { [kind]: cached[kind] })
        merged.reportState![kind] = previousState
      } else if (incoming?.validity === 'invalidated') {
        merged[kind] = undefined
      } else if (project[kind] === undefined && cached[kind]) {
        Object.assign(merged, { [kind]: cached[kind] })
        if (incoming) merged.reportState![kind] = { ...incoming, validity: 'unknown' }
      }
    }
    if (!Object.keys(merged.reportState!).length) delete merged.reportState
    if (cached.screenshot?.startsWith('data:image/png;base64,') && (!project.preview || project.preview.capturedAt === cached.preview?.capturedAt)) {
      merged.screenshot = cached.screenshot
      merged.preview = cached.preview
    }
    return merged
  }) }
}

/** Protect local writes built from an older render without reviving explicitly cleared data. */
export function protectReportRevisions(next: Workspace, previous?: Workspace): Workspace {
  if (previous?.rootPath !== next.rootPath || previous?.mode !== 'helper' || next.mode !== 'helper') return next
  const cached = new Map(previous.projects.map(project => [project.id, project]))
  return { ...next, ...(previous.helperInstanceId === next.helperInstanceId && previous.revision !== undefined ? { revision: Math.max(previous.revision, next.revision ?? 0) } : {}), projects: next.projects.map(project => {
    const saved = cached.get(project.id)
    const merged: RepoProject = { ...project, ...(saved?.reportState || project.reportState ? { reportState: { ...saved?.reportState, ...project.reportState } } : {}) }
    for (const kind of reportKinds) {
      const old = saved?.reportState?.[kind]
      const incoming = project.reportState?.[kind]
      if (old && old.helperInstanceId === next.helperInstanceId && (!incoming || (old.helperInstanceId === incoming.helperInstanceId && (old.revision > incoming.revision || (old.revision === incoming.revision && old.validity === 'invalidated'))))) {
        Object.assign(merged, { [kind]: old.validity === 'invalidated' ? undefined : saved?.[kind] })
        merged.reportState = { ...merged.reportState, [kind]: old }
      } else if (incoming?.validity === 'invalidated') {
        merged[kind] = undefined
      } else if (incoming?.validity === 'missing' && merged[kind]) {
        merged.reportState = { ...merged.reportState, [kind]: { ...incoming, validity: 'unknown' } }
      }
    }
    return merged
  }) }
}

export async function cachePreview(url: string): Promise<string> {
  if (!url.startsWith('/api/screenshots/')) throw new Error('Unexpected preview location.')
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('The preview was captured but could not be loaded. Please capture it again.')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The preview could not be saved in this browser.'))
    reader.readAsDataURL(blob)
  })
}
