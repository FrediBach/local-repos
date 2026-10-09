import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { WorkspaceToolbar } from '@/components/workspace-toolbar'
import { ProjectSearchToolbar } from '@/components/project-search-toolbar'
import { ProjectDetailDialog } from '@/components/project-detail-dialog'
import { ProjectCard } from '@/components/project-card'
import { ConnectWorkspaceDialog } from '@/components/connect-workspace-dialog'
import { WorkspaceHelpDialog } from '@/components/workspace-help-dialog'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CircleHelp, Folder, FolderOpen, RefreshCw, ShieldCheck, Star, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeControl } from '@/components/theme-control'
import { SettingsDialog } from '@/components/settings-dialog'
import { SettingsProvider, useSettings } from '@/hooks/use-settings'
import { readThemePreference } from '@/hooks/use-theme'
import { PREFERENCES_CHANGED_EVENT } from '@/lib/settings'
import { createConfigBackup, mergeConfigProjects, type ConfigBackup } from '@/lib/config-backup'
import { configureOutdatedReport } from '@/lib/outdated'
import { HostedNotice } from '@/components/hosted-notice'
import { DailySummary } from '@/components/daily-summary'
import { ProjectFilters } from '@/components/project-filters'
import { ProjectTagDialog } from '@/components/project-tags'
import { normalizeTags, type ProjectTags } from '@/lib/project-tags'
import { isRunning } from '@/lib/project-filters'
import { useProjectFiltering } from '@/hooks/use-project-filtering'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { useWorkspaceActions } from '@/hooks/use-workspace-actions'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { useWorkspaceWatcher } from '@/hooks/use-workspace-watcher'
import { CriticalVulnerabilityDialog } from '@/components/critical-vulnerability-dialog'
import { mergeCriticalAlerts, newCriticalVulnerabilities, type CriticalVulnerabilityAlert } from '@/lib/critical-vulnerabilities'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { api, projectAction, scanWithHelper, setHelperWorkspacePath } from '@/lib/api'
import { demoProjects } from '@/lib/demo'
import { canReadDirectory, chooseDirectory, scanDirectory } from '@/lib/filesystem'
import { clearWorkspace, loadFavorites, loadProjectTags, loadWorkspace, saveConfigPreferences, saveFavorites, saveProjectTags, saveWorkspace } from '@/lib/storage'
import { preservePreviews } from '@/lib/workspace'
import { isVercelHosted } from '@/lib/deployment'
import type { PackageAudit, RepoProject, Workspace } from '@/types'

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function App() {
  return <SettingsProvider><WorkspaceApp /></SettingsProvider>
}

function WorkspaceApp() {
  const { settings } = useSettings()
  const hosted = isVercelHosted()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [favorites, setFavorites] = useState<string[]>([])
  const [projectTags, setProjectTags] = useState<ProjectTags>({})
  const [tagsReady, setTagsReady] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const [tagProjectId, setTagProjectId] = useState<string>()
  const tagOpener = useRef<HTMLElement | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [connectOpen, setConnectOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [path, setPath] = useState('')
  const [helper, setHelper] = useState(false)
  const [busy, setBusy] = useState('')
  const [connectError, setConnectError] = useState('')
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const [criticalAlerts, setCriticalAlerts] = useState<CriticalVulnerabilityAlert[]>([])
  const auditHistory = useRef(new Map<string, PackageAudit>())
  const [detailTab, setDetailTab] = useState<'overview' | 'packages' | 'readme'>('overview')
  const [logs, setLogs] = useState<string>()
  const [installPrompt, setInstallPrompt] = useState<InstallEvent>()
  const [online, setOnline] = useState(navigator.onLine)
  const searchRef = useRef<HTMLInputElement>(null)
  const projectOpener = useRef<HTMLElement | null>(null)
  const workspaceVersion = useRef(0)
  const favoritesVersion = useRef(0)
  const { action, runAutomaticScan, previewBatch, auditBatch, outdatedBatch, scanAllVulnerabilities, scanAllOutdated, captureAllPreviews } = useWorkspaceActions({
    workspace, busy, workspaceVersion, setBusy, setLogs, setNotice, setConnectOpen, persist, reportCriticalVulnerabilities,
  })
  const rawProjects = workspace?.projects ?? demoProjects
  const projects = useMemo(() => rawProjects.map(project => ({ ...project, tags: projectTags[project.id] ?? [], ...(project.outdated ? { outdated: configureOutdatedReport(project.outdated, settings) } : {}) })), [rawProjects, projectTags, settings])
  const tagProject = projects.find(p => p.id === tagProjectId)
  const availableTags = useMemo(() => normalizeTags(projects.flatMap(project => project.tags)), [projects])
  const selected = projects.find(p => p.id === selectedId)
  const isDemo = !workspace
  const running = projects.filter(isRunning).length
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const favoriteCount = projects.filter(p => favoriteIds.has(p.id)).length
  const stacks = useMemo(() => [...new Set(projects.flatMap(p => p.stack))].sort((a, b) => projects.filter(p => p.stack.includes(b)).length - projects.filter(p => p.stack.includes(a)).length).slice(0, settings.sidebarTechnologyLimit), [projects, settings.sidebarTechnologyLimit])
  const { filters, setFilters, selectedTags, filter, stack, query, setQuery, searchScope, setSearchScope, sort, setSort, page, setPage,
    filterContext, filterGroups, searched, filtered, hasFilters, hasRefinements, clearFilters, toggleTechnology, toggleTag, navigate } = useProjectFiltering(projects, favorites)
  const watcher = useWorkspaceWatcher({ workspace, settings, busy: !!busy, online, run: runAutomaticScan })
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
    Promise.all([loadWorkspace(), loadFavorites()]).then(([saved, stars]) => {
      if (!active) return
      setCacheReady(true)
      if (workspaceVersion.current !== initialVersion) return
      setWorkspace(saved); if (!favoritesVersion.current) setFavorites(stars); setPath(saved?.rootPath ?? '')
      setHelperWorkspacePath(saved?.mode === 'helper' ? saved.rootPath : undefined)
    }).catch(() => setNotice({ text: 'Browser storage is unavailable. You can still browse this session.', error: true }))
    if (!hosted) api<{ ok: boolean }>('/health').then(result => active && setHelper(result.ok)).catch(() => {})
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallEvent) }
    const onOnline = () => setOnline(navigator.onLine)
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setPage('projects'); requestAnimationFrame(() => searchRef.current?.focus()) } }
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

  async function persist(next: Workspace, reportError = true) {
    setHelperWorkspacePath(next.mode === 'helper' ? next.rootPath : undefined)
    setWorkspace(next)
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
  function openProject(project: RepoProject, tab: 'overview' | 'packages' = 'overview') {
    const active = document.activeElement
    projectOpener.current = active instanceof HTMLElement && active.closest('.project-card') ? active : document.getElementById(`project-open-${project.id}`)
    setSelectedId(project.id); setDetailTab(tab); setLogs(undefined)
  }
  function toggleFavorite(id: string) {
    favoritesVersion.current += 1
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]
    setFavorites(next)
    void saveFavorites(next).catch(() => setNotice({ text: 'Could not save favorites in this browser.', error: true }))
  }
  async function connect(mode: 'browser' | 'helper') {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    const version = ++workspaceVersion.current
    setBusy('connect'); setConnectError('')
    try {
      let next: Workspace
      if (mode === 'browser') {
        const handle = await chooseDirectory()
        next = { ...await scanDirectory(handle), mode, handle }
      } else {
        if (!path.trim()) throw new Error('Enter the absolute path to your projects directory.')
        next = { ...await scanWithHelper(path.trim()), mode }
        setHelper(true)
      }
      if (version !== workspaceVersion.current) return
      if (workspace?.mode === 'helper' && (next.mode !== 'helper' || next.rootPath !== workspace.rootPath)) await stopWorkspaceServers(workspace)
      auditHistory.current.clear(); setCriticalAlerts([])
      next = preservePreviews(next, workspace)
      const cached = await persist(next); previewBatch.dismiss(); auditBatch.dismiss(); outdatedBatch.dismiss(); navigate('all'); setConnectOpen(false)
      if (cached) setNotice({ text: `Connected ${next.rootName}. Found ${next.projects.length} project${next.projects.length === 1 ? '' : 's'}.${next.warnings?.length ? ` ${next.warnings.length} scan note(s) — see workspace info.` : ''}` })
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setConnectError(error instanceof Error ? error.message : 'Unable to connect to this directory.') }
    finally { setBusy('') }
  }
  async function resync() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    if (!workspace) { setConnectOpen(true); return }
    const version = ++workspaceVersion.current
    setBusy('sync')
    try {
      let next: Workspace
      if (workspace.mode === 'helper' && workspace.rootPath) next = { ...await scanWithHelper(workspace.rootPath), mode: 'helper' }
      else if (workspace.handle) {
        if (!await canReadDirectory(workspace.handle, true)) throw new Error('Folder permission is needed to resync. Please allow read access and try again.')
        next = { ...await scanDirectory(workspace.handle), mode: 'browser', handle: workspace.handle }
      } else throw new Error('Reconnect the directory to restore folder access.')
      if (version !== workspaceVersion.current) return
      next = preservePreviews(next, workspace)
      const cached = await persist(next)
      if (cached) setNotice({ text: `Up to date. ${next.projects.length} projects synced.${next.warnings?.length ? ' Some folders could not be read; see workspace info.' : ''}` })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Sync failed. Your cached projects are still available.', error: true }) }
    finally { setBusy('') }
  }
  async function forgetWorkspace() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    ++workspaceVersion.current
    setBusy('disconnect')
    try { if (workspace) await stopWorkspaceServers(workspace); await clearWorkspace(); previewBatch.dismiss(); auditBatch.dismiss(); outdatedBatch.dismiss(); auditHistory.current.clear(); setCriticalAlerts([]); setWorkspace(undefined); setHelperWorkspacePath(undefined); setSelectedId(undefined); navigate('all'); setNotice({ text: 'Directory disconnected. Your files are unchanged.' }) }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Could not disconnect the workspace.', error: true }) }
    finally { setBusy('') }
  }

  async function stopWorkspaceServers(current: Workspace) {
    if (current.mode !== 'helper') return
    await Promise.all(current.projects.filter(project => project.dev?.status === 'running' || project.dev?.status === 'starting').map(project => projectAction(project.id, 'stop')))
  }

  const pageName = page === 'summary' ? 'Daily summary' : stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : hasFilters ? 'Filtered projects' : 'All projects')
  return <div className="app-shell">
    <a className="skip-link" href="#projects">{page === 'summary' ? 'Skip to daily summary' : 'Skip to projects'}</a>
    <WorkspaceSidebar workspace={workspace} projects={projects} stacks={stacks} busy={!!busy} page={page} filter={filter} filters={filters}
      hasFilters={hasFilters} favoriteCount={favoriteCount} running={running} navigate={navigate} onSummary={() => setPage('summary')}
      toggleTechnology={toggleTechnology} onConnect={() => setConnectOpen(true)} onHelp={() => setHelpOpen(true)}
      onInstall={installPrompt ? async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(undefined) } : undefined} />

    <main className="main-content" id="projects" tabIndex={-1}>
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><h1>{pageName}</h1></div><div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>{hosted && <HostedNotice />}<ThemeControl /><div className="local-indicator"><span className={`status-dot ${online ? '' : 'neutral'}`} /><span className="local-label">{online ? 'All local. All yours.' : 'Offline · cached workspace'}</span><button className="workspace-info-button" aria-label="Workspace info" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /></button><SettingsDialog backup={{ ready: tagsReady && cacheReady, busy: !!busy, connected: !!workspace, onExport: () => createConfigBackup(settings, readThemePreference(), workspace?.projects ?? [], favorites, projectTags), onImport: importConfig }} /></div></div></header>
      <div className="page-content">
        {page === 'summary' ? <DailySummary key={workspace?.rootPath ?? workspace?.rootName ?? 'demo'} projects={rawProjects} helper={workspace?.mode === 'helper'} onConnect={() => setConnectOpen(true)} /> : <>
        <WorkspaceToolbar workspace={workspace} projectCount={projects.length} busy={busy} onResync={resync}
          onConnect={() => { setConnectError(''); setConnectOpen(true) }} scanAllOutdated={scanAllOutdated}
          scanAllVulnerabilities={scanAllVulnerabilities} captureAllPreviews={captureAllPreviews} />

        {previewBatch.progress && <PreviewBatchProgress progress={previewBatch.progress} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
        {auditBatch.progress && <AuditBatchProgress progress={auditBatch.progress} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
        {workspace && <div className={`watcher-status ${watcher.error ? 'watcher-error' : ''}`} role="region" aria-label="Workspace watcher" aria-live="polite" title={watcher.nextRun ? `Next ${settings.watcherMode === 'changes' ? 'change check' : 'scan'}: ${new Date(watcher.nextRun).toLocaleTimeString()}. Configure in Settings → Watcher.` : 'Configure in Settings → Watcher.'}><RefreshCw size={13} className={busy === 'watcher' ? 'spinning' : ''} /><span>{watcher.message}</span>{busy === 'watcher' && <span>Change to manual mode in Settings to stop after the current check.</span>}</div>}
        {outdatedBatch.progress && <OutdatedBatchProgress progress={outdatedBatch.progress} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}

        <ProjectSearchToolbar searchRef={searchRef} query={query} setQuery={setQuery} searchScope={searchScope} setSearchScope={setSearchScope}
          sort={sort} setSort={setSort} view={view} setView={setView} />
        <ProjectFilters filters={filters} groups={filterGroups} projects={searched} context={filterContext} query={query} packageSearch={searchScope === 'packages'} total={projects.length} matching={filtered.length} onChange={setFilters} onClearSearch={() => setQuery('')} onClear={clearFilters} />

        {filtered.length ? <div className={`projects-${view}`}>{filtered.map((project, index) => <ProjectCard key={project.id} project={project} index={index} view={view} query={query}
          activeTags={filters.tags} tagsReady={tagsReady} favorite={favoriteIds.has(project.id)} capturing={previewBatch.progress?.current?.id === project.id} busy={busy}
          onOpen={openProject} onEditTags={editTags} onToggleFavorite={toggleFavorite} onTagFilter={toggleTag} onTechnologyFilter={toggleTechnology} onAction={action} />)}</div> : <div className="empty-state">{filter === 'favorites' ? <Star size={31} /> : filter === 'running' ? <Terminal size={31} /> : <FolderOpen size={31} />}<h2>{hasRefinements ? 'A little too quiet here.' : filter === 'favorites' ? 'Make room for your favorites.' : filter === 'running' ? 'Nothing running. Room to begin.' : 'Your next project starts here.'}</h2><p>{hasRefinements ? 'Try another search or clear your filters.' : filter === 'favorites' ? 'Star a project to keep it within easy reach.' : filter === 'running' ? 'Open a project and start its development server.' : 'No repositories or package.json files were found in this directory.'}</p><Button variant="outline" onClick={() => { navigate('all'); if (!projects.length) setConnectOpen(true) }}>{!projects.length ? 'Choose another directory' : 'Back to all projects'}<ArrowRight size={14} /></Button></div>}
        <footer className="page-footer"><span>{filtered.length.toString().padStart(2, '0')} {filtered.length === 1 ? 'PROJECT' : 'PROJECTS'}<span className="footer-mid-dot">·</span>{isDemo ? 'A FEW POSSIBILITIES' : 'A LITTLE POSSIBILITY IN EVERY FOLDER'}</span><span><ShieldCheck size={13} /> No cloud. No clutter.</span></footer>
        {isDemo && <div className="demo-note"><span>You’re looking at an example workspace.</span><button onClick={() => setConnectOpen(true)}>Make it yours <ArrowRight size={13} /></button></div>}
        </>}
      </div>
    </main>

    <ConnectWorkspaceDialog open={connectOpen} busy={busy} hosted={hosted} helper={helper} path={path} error={connectError}
      onOpenChange={value => { if (!busy) { setConnectOpen(value); setConnectError('') } }} onPathChange={setPath} onConnect={connect} />

    <ProjectDetailDialog selected={selected} helper={workspace?.mode === 'helper'} demo={isDemo} busy={busy}
      packageBusy={selected && auditBatch.isActive() && auditBatch.progress?.current?.id === selected.id ? `${selected.id}:audit` : selected && outdatedBatch.isActive() && outdatedBatch.progress?.current?.id === selected.id ? `${selected.id}:outdated` : busy}
      detailTab={detailTab} onTabChange={setDetailTab} logs={logs} tagsReady={tagsReady} selectedTags={selectedTags} favorite={!!selected && favoriteIds.has(selected.id)}
      onClose={() => setSelectedId(undefined)} onCloseAutoFocus={event => { if (projectOpener.current?.isConnected) { event.preventDefault(); projectOpener.current.focus() } }}
      onTagFilter={toggleTag} onEditTags={editTags} onAction={action} onToggleFavorite={toggleFavorite} />

    <WorkspaceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} workspace={workspace} busy={!!busy}
      onForget={() => { void forgetWorkspace(); setHelpOpen(false) }} />
    {tagProject && <ProjectTagDialog key={tagProject.id} project={tagProject} availableTags={availableTags} onSave={tags => updateTags(tagProject.id, tags)} onClose={() => setTagProjectId(undefined)} returnFocus={restoreTagFocus} />}
    <CriticalVulnerabilityDialog alerts={criticalAlerts} onDismiss={() => setCriticalAlerts([])} onReview={id => { const project = projects.find(item => item.id === id); setCriticalAlerts([]); if (project) openProject(project, 'packages') }} />
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}
  </div>
}
