import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownWideNarrow, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Code2, Download, Ellipsis, ExternalLink, Folder, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, LayoutGrid, List, LoaderCircle, Monitor, Package, Play, Plus, RefreshCw, Search, ShieldCheck, Star, Terminal, Unplug, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeControl } from '@/components/theme-control'
import { HostedNotice } from '@/components/hosted-notice'
import { ProjectTabs } from '@/components/project-tabs'
import { ProjectReadme } from '@/components/project-readme'
import { ProjectPreview } from '@/components/project-preview'
import { ProjectControls } from '@/components/project-controls'
import { PackageMatches, ProjectPackages } from '@/components/project-packages'
import { ProjectStoragePanel, formatBytes } from '@/components/project-storage'
import { packageMatches } from '@/lib/packages'
import { PreviewBatchProgress } from '@/components/preview-batch-progress'
import { usePreviewBatch } from '@/hooks/use-preview-batch'
import { AuditBatchProgress } from '@/components/audit-batch-progress'
import { ProjectAuditBadge } from '@/components/project-audit-badge'
import { useAuditBatch } from '@/hooks/use-audit-batch'
import { useOutdatedBatch } from '@/hooks/use-outdated-batch'
import { OutdatedBatchProgress } from '@/components/outdated-batch-progress'
import { ProjectOutdatedBadge } from '@/components/project-outdated-badge'
import { api, originUrl, projectAction, scanWithHelper } from '@/lib/api'
import { demoProjects } from '@/lib/demo'
import { canReadDirectory, chooseDirectory, scanDirectory } from '@/lib/filesystem'
import { clearWorkspace, loadFavorites, loadWorkspace, saveFavorites, saveWorkspace } from '@/lib/storage'
import { cachePreview, preservePreviews } from '@/lib/workspace'
import { installationUrl, isVercelHosted } from '@/lib/deployment'
import type { PackageAudit, PackageOutdated, RepoProject, Workspace } from '@/types'

type Filter = 'all' | 'favorites' | 'running'
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

function relativeTime(value?: string) {
  if (!value) return 'Just scanned'
  const minutes = Math.max(0, (Date.now() - Date.parse(value)) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /></span>
}

export default function App() {
  const hosted = isVercelHosted()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [favorites, setFavorites] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [stack, setStack] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'packages'>('all')
  const [sort, setSort] = useState('updated')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [connectOpen, setConnectOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [path, setPath] = useState('')
  const [helper, setHelper] = useState(false)
  const [busy, setBusy] = useState('')
  const [connectError, setConnectError] = useState('')
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
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
  const projects = workspace?.projects ?? demoProjects
  const selected = projects.find(p => p.id === selectedId)
  const isDemo = !workspace
  const running = projects.filter(p => p.dev?.status === 'running' || p.dev?.status === 'starting').length
  const favoriteCount = projects.filter(p => favorites.includes(p.id)).length
  const stacks = useMemo(() => [...new Set(projects.flatMap(p => p.stack))].sort((a, b) => projects.filter(p => p.stack.includes(b)).length - projects.filter(p => p.stack.includes(a)).length).slice(0, 7), [projects])
  const filtered = useMemo(() => projects.filter(p => {
    if (filter === 'favorites' && !favorites.includes(p.id)) return false
    if (filter === 'running' && p.dev?.status !== 'running' && p.dev?.status !== 'starting') return false
    if (stack && !p.stack.includes(stack)) return false
    const packageMatch = packageMatches(p, query).length > 0
    if (searchScope === 'packages') return !query.trim() || packageMatch
    return packageMatch || `${p.name} ${p.description} ${p.stack.join(' ')} ${p.dirName} ${p.git?.branch ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'stack' ? (a.stack[0] ?? '').localeCompare(b.stack[0] ?? '') : (Date.parse(b.updatedAt ?? b.git?.committedAt ?? b.scannedAt) || 0) - (Date.parse(a.updatedAt ?? a.git?.committedAt ?? a.scannedAt) || 0)), [projects, filter, favorites, stack, query, sort, searchScope])

  useEffect(() => {
    let active = true
    const initialVersion = workspaceVersion.current
    Promise.all([loadWorkspace(), loadFavorites()]).then(([saved, stars]) => {
      if (!active || workspaceVersion.current !== initialVersion) return
      setWorkspace(saved); if (!favoritesVersion.current) setFavorites(stars); setPath(saved?.rootPath ?? '')
      if (saved?.mode === 'helper' && saved.rootPath) {
        scanWithHelper(saved.rootPath).then(result => { if (active && workspaceVersion.current === initialVersion) { const next = preservePreviews({ ...result, mode: 'helper' }, saved); setWorkspace(next); void saveWorkspace(next).catch(() => {}) } }).catch(() => { if (active && workspaceVersion.current === initialVersion) setNotice({ text: 'Showing your cached workspace. Start the local helper and resync to refresh server status.', error: true }) })
      }
    }).catch(() => setNotice({ text: 'Browser storage is unavailable. You can still browse this session.', error: true }))
    if (!hosted) api<{ ok: boolean }>('/health').then(result => active && setHelper(result.ok)).catch(() => {})
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallEvent) }
    const onOnline = () => setOnline(navigator.onLine)
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline)
    window.addEventListener('keydown', onKey)
    return () => { active = false; window.removeEventListener('beforeinstallprompt', onInstall); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); window.removeEventListener('keydown', onKey) }
  }, [hosted])

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = setTimeout(() => setNotice(undefined), 5500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (workspace?.mode !== 'helper' || !running || busy) return
    let active = true
    const version = workspaceVersion.current
    const timer = setInterval(() => {
      for (const project of workspace.projects.filter(p => p.dev?.status === 'running' || p.dev?.status === 'starting')) {
        api<Pick<RepoProject, 'dev'>>(`/projects/${encodeURIComponent(project.id)}/status`).then(update => { if (active && version === workspaceVersion.current) setWorkspace(current => current && ({ ...current, projects: current.projects.map(p => p.id === project.id ? { ...p, ...update } : p) })) }).catch(() => {})
      }
    }, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [workspace?.mode, workspace?.projects, running, busy])

  async function persist(next: Workspace, reportError = true) {
    setWorkspace(next)
    try { await saveWorkspace(next); return true } catch { if (reportError) setNotice({ text: 'Projects loaded, but browser storage could not save this workspace.', error: true }); return false }
  }

  function navigate(next: Filter, nextStack: string | null = null) { setFilter(next); setStack(nextStack); setQuery('') }
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
      const cached = name === 'open' || await persist({ ...workspace, projects: workspace.projects.map(p => p.id === project.id ? { ...p, ...result } : p) })
      if (name === 'screenshot' && cached) {
        const kind = result.preview?.kind
        const asset = kind === 'og-image' ? 'Open Graph image' : kind === 'logo' ? 'Logo' : kind === 'favicon' ? 'Favicon' : 'Preview'
        setNotice({ text: `${asset} captured for ${project.name}${result.preview?.source === 'repository' ? ' from its repository' : result.preview?.source && result.preview.source !== 'local' ? ' from its project website' : ''}.` })
      }
      if (name === 'delete-node-modules' && cached) setNotice({ text: `Deleted root node_modules for ${project.name}. Reinstall dependencies before running it again.` })
      if (name === 'outdated' && cached) setNotice({ text: `Outdated-package scan completed for ${project.name}.` })
      if (name === 'audit' && cached) setNotice({ text: `Package audit completed for ${project.name}.` })
      if (updateLevel && result.packageUpdate) setNotice({ text: result.packageUpdate.packages.length ? `Updated ${result.packageUpdate.packages.length} packages in ${project.name}.` : `No eligible ${updateLevel} updates found for ${project.name}.` })
      if (name === 'open') setNotice({ text: 'Open request sent to your computer.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'The action could not be completed.', error: true }) }
    finally {
      if (updateLevel && workspace.rootPath) {
        const repositoryId = project.monorepo?.id ?? project.id
        const cleared = { ...workspace, projects: workspace.projects.map(item => (item.monorepo?.id ?? item.id) === repositoryId ? { ...item, outdated: undefined, audit: undefined, storage: undefined } : item) }
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
    try { if (workspace) await stopWorkspaceServers(workspace); await clearWorkspace(); previewBatch.dismiss(); auditBatch.dismiss(); outdatedBatch.dismiss(); setWorkspace(undefined); setSelectedId(undefined); navigate('all'); setNotice({ text: 'Directory disconnected. Your files are unchanged.' }) }
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
        return { cacheWarning: !cached, outdated: outdated.findings.length > 0, score: outdated.score, skipped: outdated.skipped?.length ?? 0 }
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

  const pageName = stack ?? (filter === 'favorites' ? 'Favorites' : filter === 'running' ? 'Running' : 'All projects')
  return <div className="app-shell">
    <a className="skip-link" href="#projects">Skip to projects</a>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('all') }}><Logo /><span>local repos<span className="brand-period">.</span></span></a>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace">
        <button aria-current={filter === 'all' && !stack ? 'page' : undefined} className={filter === 'all' && !stack ? 'active' : ''} onClick={() => navigate('all')}><LayoutGrid size={17} /><span>All projects</span><span className="nav-count">{projects.length}</span></button>
        <button aria-current={filter === 'favorites' ? 'page' : undefined} className={filter === 'favorites' ? 'active' : ''} onClick={() => navigate('favorites')}><Star size={17} /><span>Favorites</span><span className="nav-count">{favoriteCount.toString().padStart(2, '0')}</span></button>
        <button aria-current={filter === 'running' ? 'page' : undefined} className={filter === 'running' ? 'active' : ''} onClick={() => navigate('running')}><span className="running-icon"><Play size={14} /></span><span>Running</span>{running > 0 && <span className="nav-count">{running}</span>}</button>
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label technology-label">TECHNOLOGIES <span>{stacks.length.toString().padStart(2, '0')}</span></div>
      <nav className="stack-nav" aria-label="Filter by technology">{stacks.map(tech => <button key={tech} aria-pressed={stack === tech} className={stack === tech ? 'active' : ''} onClick={() => navigate('all', stack === tech ? null : tech)}><span className={`tech-dot tech-${tech.toLowerCase().replace(/[^a-z]/g, '')}`} /><span>{tech}</span><span className="tech-count">{projects.filter(p => p.stack.includes(tech)).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="directory-card"><div className="directory-icon"><FolderOpen size={17} /><span className={isDemo ? 'status-dot neutral' : 'status-dot'} /></div><div><strong>{workspace?.rootName ?? 'Demo workspace'}</strong><span>{isDemo ? 'A look at what’s possible' : workspace.mode === 'helper' ? 'Local helper workspace' : 'Browser folder access'}</span></div><button aria-label="Change directory" disabled={!!busy} onClick={() => setConnectOpen(true)}><ChevronDown size={15} /></button></div>
        <button className="sidebar-help" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /><span>How it works</span><ArrowUpRight size={13} /></button>
        {installPrompt && <button className="sidebar-help" onClick={async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(undefined) }}><Download size={15} /><span>Install Local Repos</span></button>}
        <div className="sidebar-footnote"><span className="status-dot" /> Yours. Locally. <span>v0.1</span></div>
      </div>
    </aside>

    <main className="main-content" id="projects" tabIndex={-1}>
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><span>{pageName}</span></div><div className={`topbar-actions ${hosted ? 'hosted-topbar-actions' : ''}`}>{hosted && <HostedNotice />}<ThemeControl /><div className="local-indicator"><span className={`status-dot ${online ? '' : 'neutral'}`} /><span className="local-label">{online ? 'All local. All yours.' : 'Offline · cached workspace'}</span><button className="workspace-info-button" aria-label="Workspace info" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /></button></div></div></header>
      <div className="page-content">
        <section className="page-heading"><div><div className="eyebrow"><span className="orange-square" /> YOUR WORK, IN ONE PLACE</div><h1>{filter === 'favorites' ? 'The ones you come back to.' : filter === 'running' ? 'A little work in progress.' : stack ? `Made with ${stack}.` : 'A place for your projects.'}</h1><p>{filter === 'favorites' ? 'Keep your go-to projects close at hand.' : filter === 'running' ? 'Your active development servers, at a glance.' : 'Less looking. More making. Pick up where you left off.'}</p></div><div className="page-heading-actions"><Button variant="outline" disabled={!!busy || !workspace || !projects.length} onClick={scanAllOutdated} aria-busy={busy === 'batch-outdated'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan outdated packages' : `Check outdated packages in all ${projects.length} projects, including those hidden by filters. Contacts their configured registries.`}>{busy === 'batch-outdated' ? <LoaderCircle size={16} className="spinning" /> : <Package size={16} />}Scan outdated packages</Button><Button variant="outline" disabled={!!busy || !workspace || !projects.length} onClick={scanAllVulnerabilities} aria-busy={busy === 'batch-audit'} title={workspace?.mode === 'browser' ? 'Connect the local helper to scan vulnerabilities' : `Audit all ${projects.length} projects, including those hidden by filters. Package names and versions are sent to their configured registries.`}>{busy === 'batch-audit' ? <LoaderCircle size={16} className="spinning" /> : <ShieldCheck size={16} />}Scan vulnerabilities</Button><Button variant="outline" disabled={!!busy || !workspace || !projects.length} onClick={captureAllPreviews} title={workspace?.mode === 'browser' ? 'Connect the local helper to capture previews' : `Capture previews for all ${projects.length} projects`}>{busy === 'batch-capture' ? <LoaderCircle size={16} className="spinning" /> : <Monitor size={16} />}Capture previews</Button><Button disabled={!!busy} onClick={() => { setConnectError(''); setConnectOpen(true) }}><Plus size={16} />{workspace ? 'Change directory' : 'Connect directory'}</Button></div></section>

        <div className="workspace-strip"><div><Folder size={15} /><span className="workspace-path">{workspace?.rootPath ?? (workspace ? workspace.rootName : '~/projects / demo workspace')}</span><span className="small-divider" /><span>{projects.length} projects</span>{isDemo && <span className="sample-badge">SAMPLE</span>}</div><button onClick={resync} disabled={!!busy} className="sync-button"><RefreshCw size={13} className={busy === 'sync' ? 'spinning' : ''} /><span>{workspace ? `Synced ${relativeTime(workspace.syncedAt).toLowerCase()}` : 'Connect your own'}</span>{!workspace && <ArrowRight size={13} />}</button></div>

        {previewBatch.progress && <PreviewBatchProgress progress={previewBatch.progress} onStop={previewBatch.stop} onDismiss={previewBatch.dismiss} />}
        {auditBatch.progress && <AuditBatchProgress progress={auditBatch.progress} onStop={auditBatch.stop} onDismiss={auditBatch.dismiss} />}
        {outdatedBatch.progress && <OutdatedBatchProgress progress={outdatedBatch.progress} onStop={outdatedBatch.stop} onDismiss={outdatedBatch.dismiss} />}

        <div className="toolbar"><div className="search-group"><select className="search-scope" aria-label="Search scope" value={searchScope} onChange={event => setSearchScope(event.target.value as 'all' | 'packages')}><option value="all">Projects & packages</option><option value="packages">Package name</option></select><div className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchScope === 'packages' ? 'e.g. react, @vitejs/plugin-react…' : 'Find a project or package…'} aria-label="Search projects" />{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>⌘ K</kbd>}</div></div><div className="toolbar-right"><label className="sort-control"><ArrowDownWideNarrow size={15} /><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort projects"><option value="updated">Last updated</option><option value="name">Name A–Z</option><option value="stack">Technology</option></select><ChevronDown size={12} /></label><div className="view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={17} /></button></div></div></div>
        {(stack || query) && <div className="filter-summary"><span>{filtered.length} {filtered.length === 1 ? 'project' : 'projects'} found{stack ? ` in ${stack}` : ''}{query.trim() && searchScope === 'packages' ? ' using matching packages · declared versions' : ''}</span><button onClick={() => { setStack(null); setQuery('') }}>Clear filters <X size={12} /></button></div>}

        {filtered.length ? <div className={`projects-${view}`}>{filtered.map((project, index) => <article className={`project-card ${previewBatch.progress?.current?.id === project.id ? 'is-capturing' : ''}`} key={project.id} style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}>
          <button className="preview-button" onClick={() => openProject(project)} aria-label={`View ${project.name}`}><ProjectPreview project={project} />{previewBatch.progress?.current?.id === project.id && <span className="project-capture-badge" title="Capturing preview"><LoaderCircle size={12} className="spinning" /><span>Capturing preview</span></span>}</button>
          <div className="project-info"><div className="project-title-row"><button id={`project-open-${project.id}`} className="project-title" onClick={() => openProject(project)}>{project.name}</button><ProjectAuditBadge project={project} onClick={() => openProject(project, 'packages')} /><ProjectOutdatedBadge project={project} onClick={() => openProject(project, 'packages')} /><button className={`favorite-button ${favorites.includes(project.id) ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(project.id)} aria-label={`${favorites.includes(project.id) ? 'Unfavorite' : 'Favorite'} ${project.name}`} aria-pressed={favorites.includes(project.id)}><Star size={16} /></button></div><p className="project-description">{project.description || 'A project waiting for its next chapter. Add a README to tell its story.'}</p><PackageMatches project={project} query={query} /><div className="project-tags">{project.monorepo && <span title={project.monorepo.packagePath}>{project.monorepo.name} workspace</span>}{!!project.workspacePackageCount && <span>{project.workspacePackageCount} workspace packages</span>}{project.stack.slice(0, 3).map(tech => <button key={tech} onClick={() => navigate('all', tech)}>{tech}</button>)}{!project.stack.length && <span>Repository</span>}{project.dev?.status === 'running' && <span className="running-tag"><span className="status-dot" /> Running</span>}</div>{project.storage && <div className="project-storage-summary" title={`Measured ${new Date(project.storage.measuredAt).toLocaleString()}`}>{project.storage.partial ? '≥ ' : ''}{formatBytes(project.storage.totalBytes)} on disk · {project.storage.partial ? '≥ ' : ''}{formatBytes(project.storage.nodeModulesBytes)} node_modules</div>}</div>
          <div className="project-footer"><span className="branch"><GitBranch size={13} /><span>{project.git?.branch ?? 'No Git branch'}</span>{project.git?.dirty && <i title="Uncommitted changes" />}</span><span className="project-date">{relativeTime(project.git?.committedAt ?? project.updatedAt)}</span><DropdownMenu modal={false}><DropdownMenuTrigger asChild><button className="project-menu" aria-label={`Actions for ${project.name}`}><Ellipsis size={17} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openProject(project)}><FolderGit2 size={14} />Project details</DropdownMenuItem><DropdownMenuItem onSelect={() => toggleFavorite(project.id)}><Star size={14} />{favorites.includes(project.id) ? 'Remove favorite' : 'Add to favorites'}</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => action(project, 'open', { app: 'vscode' })}><Code2 size={14} />Open in VS Code</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => action(project, 'open', { app: 'sourcetree' })}><GitBranch size={14} />Open in Sourcetree</DropdownMenuItem><DropdownMenuItem disabled={!!busy} onSelect={() => action(project, 'open', { app: 'folder' })}><FolderOpen size={14} />Show in folder</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        </article>)}</div> : <div className="empty-state">{filter === 'favorites' ? <Star size={31} /> : filter === 'running' ? <Terminal size={31} /> : <FolderOpen size={31} />}<h2>{query || stack ? 'A little too quiet here.' : filter === 'favorites' ? 'Make room for your favorites.' : filter === 'running' ? 'Nothing running. Room to begin.' : 'Your next project starts here.'}</h2><p>{query || stack ? 'Try another search or clear your filters.' : filter === 'favorites' ? 'Star a project to keep it within easy reach.' : filter === 'running' ? 'Open a project and start its development server.' : 'No repositories or package.json files were found in this directory.'}</p><Button variant="outline" onClick={() => { navigate('all'); if (!projects.length) setConnectOpen(true) }}>{!projects.length ? 'Choose another directory' : 'Back to all projects'}<ArrowRight size={14} /></Button></div>}
        <footer className="page-footer"><span>{filtered.length.toString().padStart(2, '0')} {filtered.length === 1 ? 'PROJECT' : 'PROJECTS'}<span className="footer-mid-dot">·</span>{isDemo ? 'A FEW POSSIBILITIES' : 'A LITTLE POSSIBILITY IN EVERY FOLDER'}</span><span><ShieldCheck size={13} /> No cloud. No clutter.</span></footer>
        {isDemo && <div className="demo-note"><span>You’re looking at an example workspace.</span><button onClick={() => setConnectOpen(true)}>Make it yours <ArrowRight size={13} /></button></div>}
      </div>
    </main>

    <Dialog open={connectOpen} onOpenChange={value => { if (!busy) { setConnectOpen(value); setConnectError('') } }}><DialogContent className="connect-dialog">
      <div className="dialog-symbol"><FolderOpen size={24} /></div><span className="eyebrow">A PLACE TO START</span>
      <DialogTitle>Bring your projects together.</DialogTitle>
      <DialogDescription>Connect the directory where your repositories live. Your files stay on your computer.</DialogDescription>
      <Button variant="outline" className="browse-button" disabled={!!busy || !('showDirectoryPicker' in window)} onClick={() => connect('browser')}><FolderOpen size={17} />Choose a local directory<ArrowUpRight size={15} /></Button>
      <p className="field-hint">{'showDirectoryPicker' in window ? 'Read-only folder access. Remembered in this browser for your next visit.' : hosted ? 'Folder picking needs desktop Chrome or Edge. You can still explore the demo here.' : 'Folder picking needs Chrome or Edge. Use the local helper below in this browser.'}</p>
      {hosted ? <div className="hosted-install-guidance">
        <h3>Want to run servers or manage packages?</h3>
        <p>Run Local Repos and its helper on your computer, then open the local address. This hosted page cannot connect to the helper.</p>
        <Button asChild variant="outline"><a href={installationUrl} target="_blank" rel="noopener noreferrer">Installation on GitHub<ArrowUpRight size={16} /></a></Button>
      </div> : <>
        <div className="or-divider"><span />FOR DEV SERVERS & LOCAL ACTIONS<span /></div>
        <label className="input-label" htmlFor="directory-path">Connect with the local helper <span className={`helper-status ${helper ? 'connected' : ''}`}><span className="status-dot" />{helper ? 'Available' : 'Not connected'}</span></label>
        <form onSubmit={event => { event.preventDefault(); void connect('helper') }}>
          <div className="path-input"><Folder size={16} /><input id="directory-path" placeholder="/Users/you/Projects" value={path} onChange={event => setPath(event.target.value)} autoComplete="off" spellCheck={false} /></div>
          <p className="field-hint">Enter an absolute path. The helper enables previews, dev servers, disk cleanup, package scans, and editor shortcuts.</p>
          {!helper && <p className="helper-instruction">Start the app and helper together with <code>npm run dev</code>.</p>}
          <Button className="connect-submit" disabled={!!busy || !path.trim()} type="submit">{busy === 'connect' ? <><LoaderCircle size={16} className="spinning" />Reading your projects…</> : <>Connect directory<ArrowRight size={16} /></>}</Button>
        </form>
      </>}
      {connectError && <p className="inline-error" role="alert">{connectError}</p>}
      <div className="dialog-privacy"><ShieldCheck size={14} />{hosted ? 'Read-only access. Your workspace stays in this browser.' : 'Local workspace. Package scans contact your package registry.'}</div>
    </DialogContent></Dialog>

    <Dialog open={!!selected} onOpenChange={value => { if (!value) setSelectedId(undefined) }}><DialogContent className="project-dialog" onCloseAutoFocus={event => { if (projectOpener.current?.isConnected) { event.preventDefault(); projectOpener.current.focus() } }}>{selected && <><div className="detail-header" role="region" aria-label="Project summary" tabIndex={0}><span className="eyebrow"><FolderGit2 size={14} /> PROJECT OVERVIEW</span><DialogTitle>{selected.name}</DialogTitle><DialogDescription>{selected.description || 'Your local project, at a glance.'}</DialogDescription><div className="detail-tags">{selected.monorepo && <span>{selected.monorepo.name} / {selected.monorepo.packagePath}</span>}{!!selected.workspacePackageCount && <span>{selected.workspacePackageCount} workspace packages</span>}{selected.stack.map(tech => <span key={tech}>{tech}</span>)}{isDemo && <span className="sample-badge">SAMPLE PROJECT</span>}</div></div><ProjectTabs value={detailTab} onChange={setDetailTab}>{detailTab === 'packages' ? <ProjectPackages key={selected.id} project={selected} helper={workspace?.mode === 'helper'} demo={isDemo} busy={auditBatch.isActive() && auditBatch.progress?.current?.id === selected.id ? `${selected.id}:audit` : outdatedBatch.isActive() && outdatedBatch.progress?.current?.id === selected.id ? `${selected.id}:outdated` : busy} onAction={name => { void action(selected, name) }} /> : detailTab === 'readme' ? <ProjectReadme content={selected.readme} /> : <><ProjectPreview project={selected} large /><div className="metadata-grid"><div><span>VERSION</span><strong>{selected.version ? `v${selected.version}` : 'Not specified'}</strong></div><div><span>AUTHOR</span><strong>{selected.author || 'Not specified'}</strong></div><div><span>BRANCH</span><strong><GitBranch size={14} />{selected.git?.branch || 'Not available'}</strong></div><div><span>LICENSE</span><strong>{selected.license || 'Not specified'}</strong></div></div><div className="commit-row"><GitCommitHorizontal size={18} /><div><strong>{selected.git?.message || 'No commit information available'}</strong><span>{selected.git?.commit?.slice(0, 7)} {selected.git?.committedAt && `· ${relativeTime(selected.git.committedAt)}`}{selected.git?.dirty && ' · Uncommitted changes'}</span></div>{originUrl(selected.git?.origin) && <a href={originUrl(selected.git?.origin)} target="_blank" rel="noreferrer" title="Open Git remote"><ExternalLink size={16} /></a>}</div><ProjectControls key={selected.id} project={selected} helper={workspace?.mode === 'helper'} demo={isDemo} busy={busy} logs={logs} onAction={(name, body) => { void action(selected, name, body) }} /><ProjectStoragePanel key={`storage:${selected.id}`} project={selected} helper={workspace?.mode === 'helper'} demo={isDemo} busy={busy} onAction={(name, body) => { void action(selected, name, body) }} /></>}</ProjectTabs><div className="detail-footer"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => action(selected, 'open', { app: 'vscode' })}><Code2 size={15} />VS Code</Button><Button variant="outline" size="sm" disabled={!!busy} onClick={() => action(selected, 'open', { app: 'sourcetree' })}><GitBranch size={15} />Sourcetree</Button><Button variant="ghost" size="sm" aria-pressed={favorites.includes(selected.id)} onClick={() => toggleFavorite(selected.id)}><Star size={15} fill={favorites.includes(selected.id) ? 'currentColor' : 'none'} />{favorites.includes(selected.id) ? 'Favorited' : 'Favorite'}</Button></div></>}</DialogContent></Dialog>

    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="help-dialog"><Logo /><DialogTitle>A little order. A lot of possibility.</DialogTitle><DialogDescription>Local Repos is a quiet home for your checked-out projects.</DialogDescription><div className="help-steps"><div><span>01</span><div><h3>Connect a directory.</h3><p>Choose your projects folder. We look for repositories and package.json files up to two folders deep, including declared monorepo workspaces and skipping dependencies and build output.</p></div></div><div><span>02</span><div><h3>Find your bearings.</h3><p>README introductions, technologies, package details, and Git history come together in one place. Favorite the projects you return to.</p></div></div><div><span>03</span><div><h3>Pick up where you left off.</h3><p>The local helper opens your editor, runs your dev script, and captures a preview. Only projects you explicitly start are run.</p></div></div></div><div className="help-cache"><ShieldCheck size={20} /><p>Your directory connection and project metadata are cached in IndexedDB. Use resync to read changes. The production PWA keeps the interface available offline.</p></div>{workspace?.warnings?.length ? <details className="scan-warnings"><summary>{workspace.warnings.length} scan notes</summary><ul>{workspace.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}{workspace && <Button variant="outline" disabled={!!busy} onClick={() => { void forgetWorkspace(); setHelpOpen(false) }}><Unplug size={15} />Forget this directory</Button>}</DialogContent></Dialog>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}
  </div>
}
