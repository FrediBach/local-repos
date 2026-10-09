import { ProjectDetailDialog } from '@/components/project-detail-dialog'
import { ProjectCard } from '@/components/project-card'
import { relativeTime } from '@/lib/relative-time'
import { ConnectWorkspaceDialog } from '@/components/connect-workspace-dialog'
import { WorkspaceHelpDialog } from '@/components/workspace-help-dialog'
import { Logo } from '@/components/brand-logo'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownWideNarrow, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleHelp, Download, Folder, FolderOpen, LayoutGrid, List, LoaderCircle, Monitor, Package, Play, RefreshCw, Search, ShieldCheck, Star, Terminal, X } from 'lucide-react'
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
import { normalizeTags, tagFilterValue, type ProjectTags } from '@/lib/project-tags'
import { isRunning, matchesProjectFilters, matchesProjectSearch, projectFilterGroups, projectSortOptions, sortProjects, type ProjectFilters as FilterState, type ProjectSort } from '@/lib/project-filters'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { usePreviewBatch } from '@/hooks/use-preview-batch'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { useAuditBatch } from '@/hooks/use-audit-batch'
import { useOutdatedBatch } from '@/hooks/use-outdated-batch'
import { useWorkspaceWatcher } from '@/hooks/use-workspace-watcher'
import { CriticalVulnerabilityDialog } from '@/components/critical-vulnerability-dialog'
import { mergeCriticalAlerts, newCriticalVulnerabilities, type CriticalVulnerabilityAlert } from '@/lib/critical-vulnerabilities'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { api, projectAction, scanWithHelper, setHelperWorkspacePath } from '@/lib/api'
import { demoProjects } from '@/lib/demo'
import { canReadDirectory, chooseDirectory, scanDirectory } from '@/lib/filesystem'
import { clearWorkspace, loadFavorites, loadProjectTags, loadWorkspace, saveConfigPreferences, saveFavorites, saveProjectTags, saveWorkspace } from '@/lib/storage'
import { cachePreview, preservePreviews } from '@/lib/workspace'
import { isVercelHosted } from '@/lib/deployment'
import type { PackageAudit, PackageOutdated, RepoProject, Workspace } from '@/types'

type Filter = 'all' | 'favorites' | 'running'
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
  const [filters, setFilters] = useState<FilterState>({})
  const selectedTags = useMemo(() => new Set(filters.tags), [filters.tags])
  const filter: Filter = filters.stars?.includes('starred') ? 'favorites' : filters.server?.includes('running') ? 'running' : 'all'
  const stack = filters.stack?.length === 1 ? filters.stack[0] : null
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'packages'>('all')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState<'projects' | 'summary'>('projects')
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
  const previewBatch = usePreviewBatch()
  const auditBatch = useAuditBatch()
  const outdatedBatch = useOutdatedBatch()
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
  const filterContext = useMemo(() => ({ favorites, now: Date.now() }), [favorites, projects])
  const filterGroups = useMemo(() => projectFilterGroups(projects, filters, settings), [projects, filters, settings])
  const searched = useMemo(() => projects.filter(p => matchesProjectSearch(p, query, searchScope)), [projects, query, searchScope])
  const filtered = useMemo(() => sortProjects(searched.filter(p => matchesProjectFilters(p, filters, filterGroups, filterContext)), sort, favorites), [searched, filters, filterGroups, filterContext, sort, favorites])
  const hasFilters = Object.values(filters).some(values => values.length > 0)
  const hasRefinements = !!query.trim() || Object.entries(filters).some(([key, values]) => values.length > 0 && !(key === 'stars' && values[0] === 'starred') && !(key === 'server' && values[0] === 'running')) || (filter === 'favorites' && !!filters.server?.length)
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
  }, [hosted])

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

  async function runAutomaticScan(changedIds: string[] | undefined, isCurrent: () => boolean, progress: (message: string) => void) {
    if (!workspace || busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    const version = ++workspaceVersion.current
    const current = () => isCurrent() && version === workspaceVersion.current
    setBusy('watcher')
    try {
      let next: Workspace
      if (workspace.mode === 'helper' && workspace.rootPath) next = { ...await scanWithHelper(workspace.rootPath), mode: 'helper' }
      else if (workspace.handle) {
        if (!await canReadDirectory(workspace.handle)) throw new Error('Watcher paused: folder permission expired. Use Synced to grant access again.')
        next = { ...await scanDirectory(workspace.handle), mode: 'browser', handle: workspace.handle }
      } else throw new Error('Reconnect the directory to enable automatic scans.')
      if (!current()) return
      next = preservePreviews(next, workspace)
      let cacheFailed = !await persist(next, false)
      const failures: string[] = []
      if (next.mode === 'helper') {
        const previousProjects = new Map(workspace.projects.map(project => [project.id, project]))
        const changed = changedIds && new Set(changedIds)
        const queue = next.projects.filter(project => !changed || changed.has(project.id) || !previousProjects.has(project.id))
        for (const project of queue) {
          const hasPackages = project.hasPackageJson ?? !!project.dependencies?.length
          const checks = [settings.watcherAudit && hasPackages && 'audit', settings.watcherOutdated && hasPackages && 'outdated', settings.watcherStorage && 'storage'].filter((check): check is string => !!check)
          for (const check of checks) {
            if (!current()) return
            progress(`${check === 'audit' ? 'Scanning vulnerabilities' : check === 'outdated' ? 'Checking outdated packages' : 'Measuring disk usage'} · ${project.name}`)
            try {
              const update = await projectAction<Partial<RepoProject>>(project.id, check)
              if (!current()) return
              if (!update[check as 'audit' | 'outdated' | 'storage']) throw new Error('The helper returned no report.')
              if (check === 'audit' && update.audit) reportCriticalVulnerabilities({ ...project, audit: previousProjects.get(project.id)?.audit }, update.audit)
              next = { ...next, projects: next.projects.map(item => item.id === project.id ? { ...item, ...update } : item) }
              cacheFailed = !await persist(next, false)
            } catch (error) {
              failures.push(`${project.name} (${check}): ${error instanceof Error ? error.message : 'Scan failed.'}`)
            }
          }
        }
      }
      if (!current()) return
      if (failures.length || cacheFailed) setNotice({ text: `Automatic scan finished${failures.length ? ` with ${failures.length} failed check(s). ${failures.slice(0, 3).join(' ')}` : '.'}${cacheFailed ? ' Results could not be saved in this browser.' : ''}`, error: true })
      return next
    } finally { if (version === workspaceVersion.current) setBusy('') }
  }

  function clearFilters() { setFilters({}); setQuery('') }
  function toggleTechnology(technology: string) {
    setPage('projects')
    setFilters(current => ({ ...current, stack: current.stack?.includes(technology) ? current.stack.filter(value => value !== technology) : [...current.stack ?? [], technology] }))
  }
  function toggleTag(tag: string) {
    const value = tagFilterValue(tag)
    setFilters(current => ({ ...current, tags: current.tags?.includes(value) ? current.tags.filter(item => item !== value) : [...current.tags ?? [], value] }))
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
  function navigate(next: Filter) {
    setPage('projects')
    if (next === 'all') { clearFilters(); return }
    const key = next === 'favorites' ? 'stars' : 'server'
    const value = next === 'favorites' ? 'starred' : 'running'
    setFilters(current => ({ ...current, [key]: page !== 'summary' && current[key]?.includes(value) ? [] : [value] }))
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
  async function action(project: RepoProject, name: string, body: unknown = {}) {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const updateLevel = name === 'update-minor' ? 'minor' : name === 'update-patches' ? 'patch' : undefined
    const version = ++workspaceVersion.current
    setBusy(`${project.id}:${name}`)
    try {
      if (name === 'logs') { const result = await api<{ logs: string }>(`/projects/${encodeURIComponent(project.id)}/logs`); setLogs(result.logs || 'No output yet. Start the dev server to see its logs.'); return }
      const result = await projectAction<Partial<RepoProject>>(project.id, updateLevel ? 'update-packages' : name, updateLevel ? { level: updateLevel } : body)
      if (name === 'screenshot' && result.screenshot) result.screenshot = await cachePreview(result.screenshot)
      if (version !== workspaceVersion.current) return
      if (name === 'audit' && result.audit) reportCriticalVulnerabilities(project, result.audit)
      const cached = name === 'open' || name === 'run-script' || await persist({ ...workspace, projects: workspace.projects.map(p => p.id === project.id ? { ...p, ...result } : p) })
      if (name === 'screenshot' && cached) {
        const kind = result.preview?.kind
        const asset = kind === 'og-image' ? 'Open Graph image' : kind === 'logo' ? 'Logo' : kind === 'favicon' ? 'Favicon' : 'Preview'
        setNotice({ text: `${asset} captured for ${project.name}${result.preview?.source === 'repository' ? ' from its repository' : result.preview?.source && result.preview.source !== 'local' ? ' from its project website' : ''}.` })
      }
      if (name === 'delete-node-modules' && cached) setNotice({ text: `Deleted root node_modules for ${project.name}. Reinstall dependencies before running it again.` })
      if (name === 'outdated' && cached) setNotice({ text: `Outdated-package scan completed for ${project.name}.` })
      if (name === 'unused' && cached) setNotice({ text: `Unused-package scan completed for ${project.name}.` })
      if (name === 'audit' && cached) setNotice({ text: `Package audit completed for ${project.name}.` })
      if (updateLevel && result.packageUpdate) setNotice({ text: result.packageUpdate.packages.length ? `Updated ${result.packageUpdate.packages.length} packages in ${project.name}.` : `No eligible ${updateLevel} updates found for ${project.name}.` })
      if (name === 'open') setNotice({ text: 'Open request sent to your computer.' })
      if (name === 'run-script') setNotice({ text: 'Script sent to your terminal. Follow its progress and stop it there.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'The action could not be completed.', error: true }) }
    finally {
      if (updateLevel && workspace.rootPath) {
        const repositoryId = project.monorepo?.id ?? project.id
        const cleared = { ...workspace, projects: workspace.projects.map(item => (item.monorepo?.id ?? item.id) === repositoryId ? { ...item, outdated: undefined, unused: undefined, audit: undefined, storage: undefined } : item) }
        try {
          const refreshed = await scanWithHelper(workspace.rootPath)
          if (version === workspaceVersion.current) await persist(preservePreviews({ ...refreshed, mode: 'helper' }, cleared), false)
        } catch { await persist(cleared, false); setNotice({ text: 'Package action finished, but metadata could not be refreshed. Resync before taking another package action.', error: true }) }
      }
      setBusy('')
    }
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

  async function scanAllVulnerabilities() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-audit')
    setNotice(undefined)
    previewBatch.dismiss()
    outdatedBatch.dismiss()
    try {
      await auditBatch.run(workspace.projects, async (project, isCurrent) => {
        const result = await projectAction<{ audit?: PackageAudit }>(project.id, 'audit')
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.audit) throw new Error('The helper did not return an audit report.')
        const audit = result.audit
        reportCriticalVulnerabilities(project, audit)
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, audit } : current) }
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, vulnerable: Object.values(audit.counts).some(count => count > 0) }
      })
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function scanAllOutdated() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-outdated')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    try {
      await outdatedBatch.run(workspace.projects, async (project, isCurrent) => {
        const result = await projectAction<{ outdated?: PackageOutdated }>(project.id, 'outdated')
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.outdated) throw new Error('The helper did not return an outdated-package report.')
        const outdated = result.outdated
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, outdated } : current) }
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, outdated: outdated.findings.length > 0, score: outdated.score, report: outdated, skipped: outdated.skipped?.length ?? 0 }
      })
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function captureAllPreviews() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-capture')
    setNotice(undefined)
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    try {
      await previewBatch.run(workspace.projects, async (project, isCurrent) => {
        const result = await projectAction<Partial<RepoProject>>(project.id, 'screenshot', { source: 'auto' })
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.screenshot) throw new Error('The helper did not return a preview image.')
        result.screenshot = await cachePreview(result.screenshot)
        if (!isCurrent() || version !== workspaceVersion.current) return
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, ...result } : current) }
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached }
      })
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  const pageName = page === 'summary' ? 'Daily summary' : stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : hasFilters ? 'Filtered projects' : 'All projects')
  const workspacePath = workspace?.rootPath ?? (workspace ? workspace.rootName : '~/projects / demo workspace')
  return <div className="app-shell">
    <a className="skip-link" href="#projects">{page === 'summary' ? 'Skip to daily summary' : 'Skip to projects'}</a>
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => navigate('all')}><Logo /><span>local repos<span className="brand-period">.</span></span></button>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace">
        <button aria-current={page === 'projects' && !hasFilters ? 'page' : undefined} className={page === 'projects' && !hasFilters ? 'active' : ''} onClick={() => navigate('all')}><LayoutGrid size={17} /><span>All projects</span><span className="nav-count">{projects.length}</span></button>
        <button aria-current={page === 'projects' && filter === 'favorites' ? 'page' : undefined} className={page === 'projects' && filter === 'favorites' ? 'active' : ''} onClick={() => navigate('favorites')}><Star size={17} /><span>Favorites</span><span className="nav-count">{favoriteCount.toString().padStart(2, '0')}</span></button>
        <button aria-current={page === 'projects' && filters.server?.includes('running') ? 'page' : undefined} className={page === 'projects' && filters.server?.includes('running') ? 'active' : ''} onClick={() => navigate('running')}><span className="running-icon"><Play size={14} /></span><span>Running</span>{running > 0 && <span className="nav-count">{running}</span>}</button>
        <button aria-current={page === 'summary' ? 'page' : undefined} className={page === 'summary' ? 'active' : ''} onClick={() => setPage('summary')}><CalendarDays size={17} /><span>Daily summary</span></button>
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label technology-label">TECHNOLOGIES <span>{stacks.length.toString().padStart(2, '0')}</span></div>
      <nav className="stack-nav" aria-label="Filter by technology">{stacks.map(tech => <button key={tech} aria-pressed={filters.stack?.includes(tech) ?? false} className={filters.stack?.includes(tech) ? 'active' : ''} onClick={() => toggleTechnology(tech)}><span className={`tech-dot tech-${tech.toLowerCase().replace(/[^a-z]/g, '')}`} /><span>{tech}</span><span className="tech-count">{projects.filter(p => p.stack.includes(tech)).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="directory-card"><div className="directory-icon"><FolderOpen size={17} /><span className={isDemo ? 'status-dot neutral' : 'status-dot'} /></div><div><strong>{workspace?.rootName ?? 'Demo workspace'}</strong><span>{isDemo ? 'A look at what’s possible' : workspace.mode === 'helper' ? 'Local helper workspace' : 'Browser folder access'}</span></div><button aria-label="Change directory" disabled={!!busy} onClick={() => setConnectOpen(true)}><ChevronDown size={15} /></button></div>
        <button className="sidebar-help" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /><span>How it works</span><ArrowUpRight size={13} /></button>
        {installPrompt && <button className="sidebar-help" onClick={async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(undefined) }}><Download size={15} /><span>Install Local Repos</span></button>}
        <div className="sidebar-footnote"><span className="status-dot" /> Yours. Locally. <span>v0.1</span></div>
      </div>
    </aside>

    <main className="main-content" id="projects" tabIndex={-1}>
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><h1>{pageName}</h1></div><div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>{hosted && <HostedNotice />}<ThemeControl /><div className="local-indicator"><span className={`status-dot ${online ? '' : 'neutral'}`} /><span className="local-label">{online ? 'All local. All yours.' : 'Offline · cached workspace'}</span><button className="workspace-info-button" aria-label="Workspace info" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /></button><SettingsDialog backup={{ ready: tagsReady && cacheReady, busy: !!busy, connected: !!workspace, onExport: () => createConfigBackup(settings, readThemePreference(), workspace?.projects ?? [], favorites, projectTags), onImport: importConfig }} /></div></div></header>
      <div className="page-content">
        {page === 'summary' ? <DailySummary key={workspace?.rootPath ?? workspace?.rootName ?? 'demo'} projects={rawProjects} helper={workspace?.mode === 'helper'} onConnect={() => setConnectOpen(true)} /> : <>
        <section className="workspace-toolbar" aria-label="Workspace controls">
          <div className="workspace-details">
            <div className="workspace-directory"><Folder size={15} /><span className="workspace-path" title={workspacePath}>{workspacePath}</span>{isDemo && <span className="sample-badge">SAMPLE</span>}</div>
            <div className="workspace-status"><span>{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>{workspace && <><span aria-hidden="true">·</span><button onClick={resync} disabled={!!busy} className="sync-button" title="Resync directory" aria-busy={busy === 'sync'}><RefreshCw size={13} className={busy === 'sync' ? 'spinning' : ''} /><span>{busy === 'sync' ? 'Syncing…' : `Synced ${relativeTime(workspace.syncedAt).toLowerCase()}`}</span></button></>}</div>
          </div>
          <div className="workspace-actions">
            <Button variant="outline" size="sm" disabled={!!busy || !workspace || !projects.length} onClick={scanAllOutdated} aria-busy={busy === 'batch-outdated'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan outdated packages' : `Check outdated packages in all ${projects.length} projects, including those hidden by filters. Contacts their configured registries.`}>{busy === 'batch-outdated' ? <LoaderCircle size={16} className="spinning" /> : <Package size={16} />}Scan outdated packages</Button>
            <Button variant="outline" size="sm" disabled={!!busy || !workspace || !projects.length} onClick={scanAllVulnerabilities} aria-busy={busy === 'batch-audit'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan vulnerabilities' : `Audit all ${projects.length} projects, including those hidden by filters. Package names and versions are sent to their configured registries.`}>{busy === 'batch-audit' ? <LoaderCircle size={16} className="spinning" /> : <ShieldCheck size={16} />}Scan vulnerabilities</Button>
            <Button variant="outline" size="sm" disabled={!!busy || !workspace || !projects.length} onClick={captureAllPreviews} aria-busy={busy === 'batch-capture'} title={workspace?.mode === 'browser' ? 'Connect the local helper to capture previews' : `Capture previews for all ${projects.length} projects`}>{busy === 'batch-capture' ? <LoaderCircle size={16} className="spinning" /> : <Monitor size={16} />}Capture previews</Button>
            <Button variant={workspace ? 'outline' : 'default'} size="sm" disabled={!!busy} onClick={() => { setConnectError(''); setConnectOpen(true) }}><FolderOpen size={16} />{workspace ? 'Change directory' : 'Connect directory'}</Button>
          </div>
        </section>

        {previewBatch.progress && <PreviewBatchProgress progress={previewBatch.progress} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
        {auditBatch.progress && <AuditBatchProgress progress={auditBatch.progress} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
        {workspace && <div className={`watcher-status ${watcher.error ? 'watcher-error' : ''}`} role="region" aria-label="Workspace watcher" aria-live="polite" title={watcher.nextRun ? `Next ${settings.watcherMode === 'changes' ? 'change check' : 'scan'}: ${new Date(watcher.nextRun).toLocaleTimeString()}. Configure in Settings → Watcher.` : 'Configure in Settings → Watcher.'}><RefreshCw size={13} className={busy === 'watcher' ? 'spinning' : ''} /><span>{watcher.message}</span>{busy === 'watcher' && <span>Change to manual mode in Settings to stop after the current check.</span>}</div>}
        {outdatedBatch.progress && <OutdatedBatchProgress progress={outdatedBatch.progress} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}

        <div className="toolbar"><div className="search-group"><select className="search-scope" aria-label="Search scope" value={searchScope} onChange={event => setSearchScope(event.target.value as 'all' | 'packages')}><option value="all">Projects & packages</option><option value="packages">Package name & version</option></select><div className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchScope === 'packages' ? 'e.g. next, next@16.0.0, next@16.*.*…' : 'Find a project or package…'} aria-label="Search projects" />{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>⌘ K</kbd>}</div></div><div className="toolbar-right"><label className="sort-control"><ArrowDownWideNarrow size={15} /><select value={sort} onChange={event => setSort(event.target.value as ProjectSort)} aria-label="Sort projects">{projectSortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} /></label><div className="view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={17} /></button></div></div></div>
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
