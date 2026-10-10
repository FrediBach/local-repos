import { useCommitActivity } from '@/hooks/use-commit-activity'
import { WorkspaceTopbar } from '@/components/workspace-topbar'
import { ProjectResults } from '@/components/project-results'
import { WorkspaceWatcherStatus } from '@/components/workspace-watcher-status'
import { WorkspaceNotice } from '@/components/workspace-notice'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { WorkspaceToolbar } from '@/components/workspace-toolbar'
import { ProjectSearchToolbar } from '@/components/project-search-toolbar'
import { ProjectDetailDialog } from '@/components/project-detail-dialog'
import type { ProjectTab } from '@/components/project-tabs'
import { ConnectWorkspaceDialog } from '@/components/connect-workspace-dialog'
import { WorkspaceHelpDialog } from '@/components/workspace-help-dialog'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Folder, ShieldCheck } from 'lucide-react'
import { SettingsProvider, useSettings } from '@/hooks/use-settings'
import { readThemePreference } from '@/hooks/use-theme'
import { PREFERENCES_CHANGED_EVENT } from '@/lib/settings'
import { createConfigBackup, mergeConfigProjects, type ConfigBackup } from '@/lib/config-backup'
import { configureOutdatedReport } from '@/lib/outdated'
import { DailySummary } from '@/components/daily-summary'
import { ProjectTodos } from '@/components/project-todos'
import { useProjectTodos } from '@/hooks/use-project-todos'
import { PushReminder } from '@/components/push-reminder'
import { usePushReminder } from '@/hooks/use-push-reminder'
import { ProjectFilters } from '@/components/project-filters'
import { ProjectTagDialog } from '@/components/project-tags'
import { normalizeTags, type ProjectTags } from '@/lib/project-tags'
import { isRunning } from '@/lib/project-filters'
import { projectCommands, type ProjectCommand } from '@/lib/project-commands'
import type { WorkspaceCommandId } from '@/lib/project-search'
import { useProjectFiltering } from '@/hooks/use-project-filtering'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { useWorkspaceActions } from '@/hooks/use-workspace-actions'
import { useScanProgress, type ActiveScanProgress } from '@/hooks/use-scan-progress'
import { ScanProgressPanel } from '@/components/scan-progress-panel'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { useWorkspaceWatcher } from '@/hooks/use-workspace-watcher'
import { CriticalVulnerabilityDialog } from '@/components/critical-vulnerability-dialog'
import { mergeCriticalAlerts, newCriticalVulnerabilities, type CriticalVulnerabilityAlert } from '@/lib/critical-vulnerabilities'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { ReactDoctorBatchProgress } from '@/components/react-doctor-batch-progress'
import { LighthouseBatchProgress } from '@/components/lighthouse-batch-progress'
import { api, projectAction, scanWithHelper, setHelperWorkspacePath } from '@/lib/api'
import { demoProjects } from '@/lib/demo'
import { canReadDirectory, chooseDirectory, scanDirectory } from '@/lib/filesystem'
import { clearWorkspace, loadFavorites, loadProjectTags, loadWorkspace, saveConfigPreferences, saveFavorites, saveProjectTags, saveWorkspace } from '@/lib/storage'
import { preservePreviews } from '@/lib/workspace'
import { isVercelHosted } from '@/lib/deployment'
import type { PackageAudit, RepoProject, Workspace } from '@/types'

const emptyProjects: RepoProject[] = []

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function App() {
  return <SettingsProvider><WorkspaceApp /></SettingsProvider>
}

function WorkspaceApp() {
  const { settings } = useSettings()
  const hosted = isVercelHosted()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [activitySync, setActivitySync] = useState<Workspace>()
  const commitActivity = useCommitActivity(workspace, activitySync, settings.commitActivityAuthor)
  const [favorites, setFavorites] = useState<string[]>([])
  const [projectTags, setProjectTags] = useState<ProjectTags>({})
  const [tagsReady, setTagsReady] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tagProjectId, setTagProjectId] = useState<string>()
  const tagOpener = useRef<HTMLElement | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [connectOpen, setConnectOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [todoProjectId, setTodoProjectId] = useState<string>()
  const [path, setPath] = useState('')
  const [helper, setHelper] = useState(false)
  const [busy, setBusy] = useState('')
  const [connectError, setConnectError] = useState('')
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const [criticalAlerts, setCriticalAlerts] = useState<CriticalVulnerabilityAlert[]>([])
  const auditHistory = useRef(new Map<string, PackageAudit>())
  const [detailTab, setDetailTab] = useState<ProjectTab>('overview')
  const [logs, setLogs] = useState<string>()
  const [installPrompt, setInstallPrompt] = useState<InstallEvent>()
  const [online, setOnline] = useState(navigator.onLine)
  const searchRef = useRef<HTMLInputElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const projectOpener = useRef<HTMLElement | null>(null)
  const workspaceVersion = useRef(0)
  const favoritesVersion = useRef(0)
  const metadataProgress = useScanProgress()
  const { action, packageBusy, runAutomaticScan, scanProgress, previewBatch, auditBatch, outdatedBatch, reactDoctorBatch, lighthouseBatch, scanAllVulnerabilities, scanAllOutdated, scanAllReactDoctor, scanAllLighthouse, captureAllPreviews } = useWorkspaceActions({
    workspace, busy, workspaceVersion, setBusy, setLogs, setNotice, setConnectOpen, persist, reportCriticalVulnerabilities,
  })
  const rawProjects = workspace?.projects ?? (workspaceStatus === 'ready' ? demoProjects : emptyProjects)
  const projects = useMemo(() => rawProjects.map(project => ({ ...project, tags: projectTags[project.id] ?? [], ...(project.outdated ? { outdated: configureOutdatedReport(project.outdated, settings) } : {}) })), [rawProjects, projectTags, settings])
  const projectTodos = useProjectTodos(projects, workspace)
  const tagProject = projects.find(p => p.id === tagProjectId)
  const availableTags = useMemo(() => normalizeTags(projects.flatMap(project => project.tags)), [projects])
  const selected = projects.find(p => p.id === selectedId)
  const selectedBatch = [
    { title: 'Scanning vulnerabilities', progress: auditBatch.progress },
    { title: 'Checking outdated packages', progress: outdatedBatch.progress },
    { title: 'Running React Doctor', progress: reactDoctorBatch.progress },
    { title: 'Running Lighthouse', progress: lighthouseBatch.progress },
    { title: 'Capturing preview', progress: previewBatch.progress },
  ].find(batch => batch.progress?.current?.id === selectedId && batch.progress?.stage)
  const activeScanProgress = metadataProgress.progress ?? scanProgress
  const selectedScanProgress: ActiveScanProgress | undefined = scanProgress?.projectId === selectedId ? scanProgress
    : selectedBatch?.progress?.stage && selectedBatch.progress.stageStartedAt !== undefined && selectedBatch.progress.startedAt !== undefined ? {
      title: selectedBatch.title, projectId: selectedId, projectName: selected?.name, stage: selectedBatch.progress.stage,
      stageStartedAt: selectedBatch.progress.stageStartedAt, startedAt: selectedBatch.progress.startedAt,
    } : undefined
  const isDemo = !workspace && workspaceStatus === 'ready'
  const running = projects.filter(isRunning).length
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const favoriteCount = projects.filter(p => favoriteIds.has(p.id)).length
  const stacks = useMemo(() => [...new Set(projects.flatMap(p => p.stack))].sort((a, b) => projects.filter(p => p.stack.includes(b)).length - projects.filter(p => p.stack.includes(a)).length).slice(0, settings.sidebarTechnologyLimit), [projects, settings.sidebarTechnologyLimit])
  const { filters, setFilters, selectedTags, filter, stack, query, setQuery, searchReset, searchScope, setSearchScope, sort, setSort, page, setPage,
    filterContext, filterGroups, searched, filtered, hasFilters, hasRefinements, clearFilters, toggleTechnology, toggleTag, navigate } = useProjectFiltering(projects, favorites)
  const watcher = useWorkspaceWatcher({ workspace, settings, busy: !!busy, online, run: runAutomaticScan })
  const pushReminder = usePushReminder({ workspace, settings, busy: !!busy })
  const configContext = useRef({ workspace, favorites, projectTags, busy, ready: tagsReady && cacheReady })
  useLayoutEffect(() => {
    configContext.current = { workspace, favorites, projectTags, busy, ready: tagsReady && cacheReady }
  }, [workspace, favorites, projectTags, busy, tagsReady, cacheReady])

  useEffect(() => {
    let active = true
    loadProjectTags().then(tags => { if (active) { setProjectTags(tags); setTagsReady(true) } })
      .catch(() => { if (active) setNotice({ text: 'Saved tags could not be loaded. Reload to try again.', error: true }) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const initialVersion = workspaceVersion.current
    const workspaceLoad = loadWorkspace().then(saved => {
      if (!active || workspaceVersion.current !== initialVersion) return
      setWorkspace(saved); setPath(saved?.rootPath ?? '')
      setWorkspaceStatus('ready')
      setHelperWorkspacePath(saved?.mode === 'helper' ? saved.rootPath : undefined)
    }).catch(error => {
      if (active && workspaceVersion.current === initialVersion) setWorkspaceStatus('error')
      throw error
    })
    const favoritesLoad = loadFavorites().then(stars => {
      if (active && !favoritesVersion.current) setFavorites(stars)
    })
    Promise.all([workspaceLoad, favoritesLoad]).then(() => {
      if (active) setCacheReady(true)
    }).catch(() => { if (active) setNotice({ text: 'Browser storage is unavailable. You can still browse this session.', error: true }) })
    if (!hosted) api<{ ok: boolean }>('/health').then(result => active && setHelper(result.ok)).catch(() => {})
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallEvent) }
    const onOnline = () => setOnline(navigator.onLine)
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); setPage('projects'); requestAnimationFrame(() => searchRef.current?.focus()) } }
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline)
    window.addEventListener('keydown', onKey)
    return () => { active = false; window.removeEventListener('beforeinstallprompt', onInstall); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); window.removeEventListener('keydown', onKey) }
  }, [hosted, setPage])

  useEffect(() => {
    if (!notice || notice.error || settings.notificationSeconds === 0) return
    const timer = setTimeout(() => setNotice(undefined), settings.notificationSeconds * 1000)
    return () => clearTimeout(timer)
  }, [notice, settings.notificationSeconds])

  useEffect(() => {
    if (workspace?.mode !== 'helper' || !running || busy) return
    let active = true
    const version = workspaceVersion.current
    const timer = setInterval(() => {
      for (const project of workspace.projects.filter(p => p.dev?.status === 'running' || p.dev?.status === 'starting')) {
        api<Pick<RepoProject, 'dev'>>(`/projects/${encodeURIComponent(project.id)}/status`).then(update => { if (active && version === workspaceVersion.current) setWorkspace(current => current && ({ ...current, projects: current.projects.map(p => p.id === project.id ? { ...p, ...update } : p) })) }).catch(() => {})
      }
    }, settings.statusPollSeconds * 1000)
    return () => { active = false; clearInterval(timer) }
  }, [workspace?.mode, workspace?.projects, running, busy, settings.statusPollSeconds])

  async function persist(next: Workspace, reportError = true, refreshActivity = false) {
    setHelperWorkspacePath(next.mode === 'helper' ? next.rootPath : undefined)
    setWorkspace(next)
    setWorkspaceStatus('ready')
    if (refreshActivity) setActivitySync(next)
    try { await saveWorkspace(next); return true } catch { if (reportError) setNotice({ text: 'Projects loaded, but browser storage could not save this workspace.', error: true }); return false }
  }

  function reportCriticalVulnerabilities(project: RepoProject, audit: PackageAudit) {
    const changes = newCriticalVulnerabilities(auditHistory.current.get(project.id) ?? project.audit, audit)
    auditHistory.current.set(project.id, audit)
    if (changes.findings.length || changes.additionalCount) {
      setCriticalAlerts(current => mergeCriticalAlerts(current, { projectId: project.id, projectName: project.name, ...changes }))
    }
  }

  function editTags(project: RepoProject) {
    tagOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTagProjectId(project.id)
  }
  async function updateTags(id: string, tags: string[]) {
    const next = { ...projectTags, [id]: normalizeTags(tags) }
    if (!next[id].length) delete next[id]
    await saveProjectTags(next)
    setProjectTags(next)
  }
  async function importConfig(backup: ConfigBackup) {
    // File reading is asynchronous: match against the current directory and preferences.
    const current = configContext.current
    if (!current.ready || current.busy) throw new Error('Wait for the workspace and saved preferences to finish loading, then try importing again.')
    const result = mergeConfigProjects(backup, current.workspace?.projects ?? [], current.favorites, current.projectTags)
    setBusy('config-import')
    try {
      await saveConfigPreferences(backup, result.favorites, result.tags)
      favoritesVersion.current += 1
      setFavorites(result.favorites); setProjectTags(result.tags)
      window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT))
      return result
    } finally { setBusy('') }
  }
  function restoreTagFocus() {
    if (tagOpener.current?.isConnected) tagOpener.current.focus()
    else if (selectedId) document.getElementById('edit-detail-tags')?.focus()
    else (document.getElementById(`project-open-${tagProjectId}`) ?? searchRef.current)?.focus()
  }
  function openProject(project: RepoProject, tab: ProjectTab = 'overview') {
    const active = document.activeElement
    projectOpener.current = active instanceof HTMLElement && active.closest('.project-card, .project-todos, .command-search') ? active : document.getElementById(`project-open-${project.id}`)
    setSelectedId(project.id); setDetailTab(tab); setLogs(undefined)
  }
  function openTodos(project?: RepoProject) {
    setTodoProjectId(project?.id)
    setPage('todos')
  }
  function toggleFavorite(id: string) {
    favoritesVersion.current += 1
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]
    setFavorites(next)
    void saveFavorites(next).catch(() => setNotice({ text: 'Could not save favorites in this browser.', error: true }))
  }
  function runCommand(project: RepoProject, selectedCommand: ProjectCommand) {
    // Resolve from current metadata; the helper also revalidates script commands.
    const command = projectCommands(project, settings, favoriteIds.has(project.id)).find(item => item.id === selectedCommand.id)
    if (!command || (command.helper && busy)) return
    const intent = command.intent
    if (intent.kind === 'details') openProject(project, intent.tab)
    else if (intent.kind === 'tags') { if (tagsReady) editTags(project) }
    else if (intent.kind === 'favorite') toggleFavorite(project.id)
    else if (intent.kind === 'todos') openTodos(project)
    else {
      if (intent.name === 'logs' && workspace?.mode === 'helper') openProject(project, 'development')
      void action(project, intent.name, intent.body)
    }
  }
  function runWorkspaceCommand(command: WorkspaceCommandId) {
    const commands: Record<WorkspaceCommandId, () => void> = {
      'all-projects': () => navigate('all'),
      favorites: () => { setPage('projects'); setFilters({ stars: ['starred'] }) },
      running: () => { setPage('projects'); setFilters({ server: ['running'] }) },
      summary: () => setPage('summary'), todos: () => openTodos(),
      resync: () => { void resync() },
      connect: () => { if (!busy) { setConnectError(''); setConnectOpen(true) } },
      help: () => setHelpOpen(true), settings: () => settingsTriggerRef.current?.click(),
      'clear-filters': clearFilters,
      'audit-all': () => { void scanAllVulnerabilities() },
      'outdated-all': () => { void scanAllOutdated() },
      'react-doctor-all': () => { void scanAllReactDoctor() },
      'lighthouse-all': () => { void scanAllLighthouse() },
      'previews-all': () => { void captureAllPreviews() },
    }
    commands[command]()
  }
  async function connect(mode: 'browser' | 'helper') {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    const version = ++workspaceVersion.current
    setBusy('connect'); setConnectError('')
    const scan = metadataProgress.begin('Connecting directory', () => version === workspaceVersion.current)
    try {
      let next: Workspace
      if (mode === 'browser') {
        const handle = await chooseDirectory()
        next = { ...await scanDirectory(handle, scan.report), mode, handle }
      } else {
        if (!path.trim()) throw new Error('Enter the absolute path to your projects directory.')
        next = { ...await scanWithHelper(path.trim(), scan.report), mode }
        setHelper(true)
      }
      if (version !== workspaceVersion.current) return
      if (workspace?.mode === 'helper' && (next.mode !== 'helper' || next.rootPath !== workspace.rootPath)) await stopWorkspaceServers(workspace)
      auditHistory.current.clear(); setCriticalAlerts([])
      next = preservePreviews(next, workspace)
      scan.report({ phase: 'Saving project metadata' })
      const cached = await persist(next, true, true); previewBatch.dismiss(); auditBatch.dismiss(); outdatedBatch.dismiss(); reactDoctorBatch.dismiss(); lighthouseBatch.dismiss(); navigate('all'); setConnectOpen(false)
      if (cached) setNotice({ text: `Connected ${next.rootName}. Found ${next.projects.length} project${next.projects.length === 1 ? '' : 's'}.${next.warnings?.length ? ` ${next.warnings.length} scan note(s) — see workspace info.` : ''}` })
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setConnectError(error instanceof Error ? error.message : 'Unable to connect to this directory.') }
    finally { scan.finish(); if (version === workspaceVersion.current) setBusy('') }
  }
  async function resync() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (!workspace) { setConnectOpen(true); return }
    const version = ++workspaceVersion.current
    setBusy('sync')
    const scan = metadataProgress.begin('Syncing project metadata', () => version === workspaceVersion.current)
    try {
      let next: Workspace
      if (workspace.mode === 'helper' && workspace.rootPath) next = { ...await scanWithHelper(workspace.rootPath, scan.report), mode: 'helper' }
      else if (workspace.handle) {
        if (!await canReadDirectory(workspace.handle, true)) throw new Error('Folder permission is needed to resync. Please allow read access and try again.')
        next = { ...await scanDirectory(workspace.handle, scan.report), mode: 'browser', handle: workspace.handle }
      } else throw new Error('Reconnect the directory to restore folder access.')
      if (version !== workspaceVersion.current) return
      next = preservePreviews(next, workspace)
      scan.report({ phase: 'Saving project metadata' })
      const cached = await persist(next, true, true)
      if (cached) setNotice({ text: `Up to date. ${next.projects.length} projects synced.${next.warnings?.length ? ' Some folders could not be read; see workspace info.' : ''}` })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Sync failed. Your cached projects are still available.', error: true }) }
    finally { scan.finish(); if (version === workspaceVersion.current) setBusy('') }
  }
  async function forgetWorkspace() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    ++workspaceVersion.current
    setBusy('disconnect')
    try { if (workspace) await stopWorkspaceServers(workspace); await clearWorkspace(); previewBatch.dismiss(); auditBatch.dismiss(); outdatedBatch.dismiss(); reactDoctorBatch.dismiss(); lighthouseBatch.dismiss(); auditHistory.current.clear(); setCriticalAlerts([]); setWorkspace(undefined); setWorkspaceStatus('ready'); setHelperWorkspacePath(undefined); setSelectedId(undefined); navigate('all'); setNotice({ text: 'Directory disconnected. Your files are unchanged.' }) }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Could not disconnect the workspace.', error: true }) }
    finally { setBusy('') }
  }

  async function stopWorkspaceServers(current: Workspace) {
    if (current.mode !== 'helper') return
    await Promise.all(current.projects.filter(project => project.dev?.status === 'running' || project.dev?.status === 'starting').map(project => projectAction(project.id, 'stop')))
  }

  return <div className="app-shell">
    <a className="skip-link" href="#projects">{page === 'todos' ? 'Skip to todos' : page === 'summary' ? 'Skip to daily summary' : 'Skip to projects'}</a>
    <WorkspaceSidebar workspaceStatus={workspaceStatus} workspace={workspace} projects={projects} stacks={stacks} busy={!!busy} page={page} filter={filter} filters={filters}
      hasFilters={hasFilters} favoriteCount={favoriteCount} running={running} navigate={navigate} onSummary={() => setPage('summary')}
      onTodos={() => openTodos()} todoCount={projectTodos.todos.length}
      toggleTechnology={toggleTechnology} onConnect={() => setConnectOpen(true)} onHelp={() => setHelpOpen(true)}
      onInstall={installPrompt ? async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(undefined) } : undefined} />

    <main className="main-content" id="projects" tabIndex={-1}>
      <WorkspaceTopbar activity={commitActivity.activity} settingsTriggerRef={settingsTriggerRef} page={page} stack={stack} filter={filter} hasFilters={hasFilters} hosted={hosted} online={online}
        connected={!!workspace} busy={!!busy} onConnect={() => { setConnectError(''); setConnectOpen(true) }}
        onHelp={() => setHelpOpen(true)} backup={{ ready: tagsReady && cacheReady, busy: !!busy, connected: !!workspace, onExport: () => createConfigBackup(settings, readThemePreference(), workspace?.projects ?? [], favorites, projectTags), onImport: importConfig }} />
      <div className="page-content">
        {activeScanProgress && <ScanProgressPanel progress={activeScanProgress} />}
        <PushReminder results={pushReminder.results} checking={pushReminder.checking} busy={!!busy} onRefresh={pushReminder.refresh} onDismiss={pushReminder.dismiss}
          onOpen={id => { const project = projects.find(project => project.id === id); if (project) openProject(project) }} />
        {!workspace && workspaceStatus !== 'ready' ? <div className="empty-state" role="status">
          <Folder size={24} aria-hidden="true" />
          <h2>{workspaceStatus === 'loading' ? 'Loading saved workspace…' : 'Saved workspace could not be loaded.'}</h2>
          {workspaceStatus === 'error' && <p>Reload to try again, or connect a directory to browse this session.</p>}
        </div> : page === 'todos' ? <>
          {projectTodos.storageError && <p role="alert">Todo dismissals could not be saved in this browser. They will stay dismissed for this session.</p>}
          <ProjectTodos projects={projects} todos={projectTodos.todos} projectId={todoProjectId} onClearProject={() => setTodoProjectId(undefined)} onOpen={openProject} onDismiss={projectTodos.dismiss} isDemo={isDemo} onConnect={() => setConnectOpen(true)} />
        </> : page === 'summary' ? <DailySummary key={workspace?.rootPath ?? workspace?.rootName ?? 'demo'} projects={rawProjects} helper={workspace?.mode === 'helper'} onConnect={() => setConnectOpen(true)} /> : <>
        <WorkspaceToolbar workspace={workspace} projectCount={projects.length} busy={busy} onResync={resync}
          scanAllOutdated={scanAllOutdated}
          scanAllVulnerabilities={scanAllVulnerabilities} scanAllReactDoctor={scanAllReactDoctor} scanAllLighthouse={scanAllLighthouse} captureAllPreviews={captureAllPreviews} />

        {previewBatch.progress && <PreviewBatchProgress progress={previewBatch.progress} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
        {auditBatch.progress && <AuditBatchProgress progress={auditBatch.progress} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
        {workspace && <WorkspaceWatcherStatus watcher={watcher} mode={settings.watcherMode} scanning={busy === 'watcher'} />}
        {outdatedBatch.progress && <OutdatedBatchProgress progress={outdatedBatch.progress} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}
        {reactDoctorBatch.progress && <ReactDoctorBatchProgress progress={reactDoctorBatch.progress} onStop={reactDoctorBatch.stop} onDismiss={reactDoctorBatch.dismiss} />}
        {lighthouseBatch.progress && <LighthouseBatchProgress progress={lighthouseBatch.progress} onStop={lighthouseBatch.stop} onDismiss={lighthouseBatch.dismiss} />}

        <ProjectSearchToolbar key={`${workspace?.mode ?? 'demo'}:${workspace?.rootPath ?? workspace?.rootName ?? ''}:${searchReset}`} searchRef={searchRef} query={query} setQuery={setQuery} searchScope={searchScope} setSearchScope={setSearchScope}
          projects={projects} favorites={favorites} filterGroups={filterGroups} helper={workspace?.mode === 'helper'} busy={!!busy} tagsReady={tagsReady}
          onCommand={runCommand} onWorkspaceCommand={runWorkspaceCommand} onFilter={(key, value) => setFilters(current => ({ ...current, [key]: filterGroups.find(group => group.key === key)?.multiple ? [...new Set([...(current[key] ?? []), value])] : [value] }))}
          sort={sort} setSort={setSort} view={view} setView={setView} />
        <ProjectFilters filters={filters} groups={filterGroups} projects={searched} context={filterContext} query={query} packageSearch={searchScope === 'packages'} total={projects.length} matching={filtered.length} onChange={setFilters} onClearSearch={() => setQuery('')} onClear={clearFilters} />

        <ProjectResults projects={filtered} allProjects={projects} favoriteIds={favoriteIds} capturingId={previewBatch.progress?.current?.id}
          todoCounts={projectTodos.counts} onTodos={openTodos}
          filter={filter} hasRefinements={hasRefinements} emptyWorkspace={!projects.length} isDemo={isDemo}
          onReset={() => { navigate('all'); if (!projects.length) setConnectOpen(true) }} onConnect={() => setConnectOpen(true)}
          view={view} query={query} activeTags={filters.tags} tagsReady={tagsReady} busy={busy} onOpen={openProject} onEditTags={editTags}
          onToggleFavorite={toggleFavorite} onTagFilter={toggleTag} onTechnologyFilter={toggleTechnology} onAction={action} />
        </>}
      </div>
    </main>

    <ConnectWorkspaceDialog scanProgress={metadataProgress.progress} open={connectOpen} busy={busy} hosted={hosted} helper={helper} path={path} error={connectError}
      onOpenChange={value => { if (!busy) { setConnectOpen(value); setConnectError('') } }} onPathChange={setPath} onConnect={connect} />

    <ProjectDetailDialog scanProgress={selectedScanProgress} onActivity={commitActivity.remember} selected={selected} helper={workspace?.mode === 'helper'} demo={isDemo} busy={busy}
      packageBusy={packageBusy(selected)}
      detailTab={detailTab} onTabChange={setDetailTab} logs={logs} tagsReady={tagsReady} selectedTags={selectedTags} favorite={!!selected && favoriteIds.has(selected.id)}
      onClose={() => setSelectedId(undefined)} onCloseAutoFocus={event => { if (projectOpener.current?.isConnected) { event.preventDefault(); projectOpener.current.focus() } }}
      onTagFilter={toggleTag} onEditTags={editTags} onAction={action} onToggleFavorite={toggleFavorite} />

    <WorkspaceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} workspace={workspace} busy={!!busy}
      onForget={() => { void forgetWorkspace(); setHelpOpen(false) }} />
    {tagProject && <ProjectTagDialog key={tagProject.id} project={tagProject} availableTags={availableTags} onSave={tags => updateTags(tagProject.id, tags)} onClose={() => setTagProjectId(undefined)} returnFocus={restoreTagFocus} />}
    <CriticalVulnerabilityDialog alerts={criticalAlerts} onDismiss={() => setCriticalAlerts([])} onReview={id => { const project = projects.find(item => item.id === id); setCriticalAlerts([]); if (project) openProject(project, 'vulnerabilities') }} />
    <WorkspaceNotice notice={notice} onDismiss={() => setNotice(undefined)} />
  </div>
}
