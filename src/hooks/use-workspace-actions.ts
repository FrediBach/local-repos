import type { RefObject } from 'react'
import { useScanProgress } from './use-scan-progress'
import { usePreviewBatch } from './use-preview-batch'
import { useAuditBatch } from './use-audit-batch'
import { useOutdatedBatch } from './use-outdated-batch'
import { useReactDoctorBatch } from './use-react-doctor-batch'
import { useLighthouseBatch } from './use-lighthouse-batch'
import { api, projectAction, scanWithHelper } from '@/lib/api'
import { canReadDirectory, scanDirectory } from '@/lib/filesystem'
import { useSettings } from './use-settings'
import { cachePreview, packageWorkspaceId, preservePreviews } from '@/lib/workspace'
import { isReactProject } from '@/lib/react-doctor'
import { isLighthouseProject } from '@/lib/lighthouse'
import type { LighthouseReport, PackageAudit, PackageOutdated, PackageUpdate, ReactDoctorReport, RepoProject, RunProjectScriptRequest, ScanProgressReporter, Workspace } from '@/types'

interface Options {
  workspace?: Workspace
  busy: string
  workspaceVersion: RefObject<number>
  setBusy: (busy: string) => void
  setLogs: (logs: string) => void
  setNotice: (notice: { text: string; error?: boolean } | undefined) => void
  setConnectOpen: (open: boolean) => void
  persist: (workspace: Workspace, reportError?: boolean, refreshActivity?: boolean) => Promise<boolean>
  reportCriticalVulnerabilities: (project: RepoProject, audit: PackageAudit) => void
}

export function useWorkspaceActions({ workspace, busy, workspaceVersion, setBusy, setLogs, setNotice, setConnectOpen, persist, reportCriticalVulnerabilities }: Options) {
  const { settings } = useSettings()
  const previewBatch = usePreviewBatch()
  const auditBatch = useAuditBatch()
  const outdatedBatch = useOutdatedBatch()
  const reactDoctorBatch = useReactDoctorBatch()
  const lighthouseBatch = useLighthouseBatch()
  const scans = useScanProgress()

  async function scanAllVulnerabilities() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-audit')
    setNotice(undefined)
    previewBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    lighthouseBatch.dismiss()
    try {
      await auditBatch.run(workspace.projects, async (project, isCurrent, reportProgress) => {
        const result = await projectAction<{ audit?: PackageAudit }>(project.id, 'audit', {}, reportProgress)
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.audit) throw new Error('The helper did not return an audit report.')
        const audit = result.audit
        reportCriticalVulnerabilities(project, audit)
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, audit } : current) }
        reportProgress({ phase: 'Saving results', detail: 'Updating the workspace cache in this browser.' })
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, vulnerable: Object.values(audit.counts).some(count => count > 0) }
      }, () => version === workspaceVersion.current)
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function scanAllOutdated() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-outdated')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    reactDoctorBatch.dismiss()
    lighthouseBatch.dismiss()
    try {
      await outdatedBatch.run(workspace.projects, async (project, isCurrent, reportProgress) => {
        const result = await projectAction<{ outdated?: PackageOutdated }>(project.id, 'outdated', {}, reportProgress)
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.outdated) throw new Error('The helper did not return an outdated-package report.')
        const outdated = result.outdated
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, outdated } : current) }
        reportProgress({ phase: 'Saving results', detail: 'Updating the workspace cache in this browser.' })
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, outdated: outdated.findings.length > 0, score: outdated.score, report: outdated, skipped: outdated.skipped?.length ?? 0 }
      }, () => version === workspaceVersion.current)
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function scanAllReactDoctor() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const projects = workspace.projects.filter(isReactProject)
    if (!projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-react-doctor')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    lighthouseBatch.dismiss()
    try {
      await reactDoctorBatch.run(projects, async (project, isCurrent, reportProgress) => {
        const result = await projectAction<{ reactDoctor?: ReactDoctorReport }>(project.id, 'react-doctor', {}, reportProgress)
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.reactDoctor) throw new Error('The helper did not return a React Doctor report.')
        const reactDoctor = result.reactDoctor
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, reactDoctor } : current) }
        reportProgress({ phase: 'Saving results', detail: 'Updating the workspace cache in this browser.' })
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, report: reactDoctor }
      }, () => version === workspaceVersion.current)
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function scanAllLighthouse() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const projects = workspace.projects.filter(isLighthouseProject)
    if (!projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-lighthouse')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    try {
      await lighthouseBatch.run(projects, async (project, isCurrent, reportProgress) => {
        const result = await projectAction<{ lighthouse?: LighthouseReport }>(project.id, 'lighthouse', {}, reportProgress)
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.lighthouse) throw new Error('The helper did not return a Lighthouse report.')
        const lighthouse = result.lighthouse
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, lighthouse } : current) }
        reportProgress({ phase: 'Saving results', detail: 'Updating the workspace cache in this browser.' })
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, report: lighthouse }
      }, () => version === workspaceVersion.current)
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function captureAllPreviews() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-capture')
    setNotice(undefined)
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    lighthouseBatch.dismiss()
    try {
      await previewBatch.run(workspace.projects, async (project, isCurrent, reportProgress) => {
        const result = await projectAction<Partial<RepoProject>>(project.id, 'screenshot', { source: 'auto' }, reportProgress)
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.screenshot) throw new Error('The helper did not return a preview image.')
        reportProgress({ phase: 'Saving preview', detail: 'Caching the captured image in this browser.' })
        result.screenshot = await cachePreview(result.screenshot)
        if (!isCurrent() || version !== workspaceVersion.current) return
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, ...result } : current) }
        reportProgress({ phase: 'Saving results', detail: 'Updating the workspace cache in this browser.' })
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached }
      }, () => version === workspaceVersion.current)
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function runAutomaticScan(changedIds: string[] | undefined, isCurrent: () => boolean, progress: (message: string) => void) {
    if (!workspace || busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    const version = ++workspaceVersion.current
    const current = () => isCurrent() && version === workspaceVersion.current
    setBusy('watcher')
    let scan = scans.begin('Syncing project metadata', current)
    try {
      let next: Workspace
      if (workspace.mode === 'helper' && workspace.rootPath) next = { ...await scanWithHelper(workspace.rootPath, scan.report), mode: 'helper' }
      else if (workspace.handle) {
        if (!await canReadDirectory(workspace.handle)) throw new Error('Watcher paused: folder permission expired. Use Synced to grant access again.')
        next = { ...await scanDirectory(workspace.handle, scan.report), mode: 'browser', handle: workspace.handle }
      } else throw new Error('Reconnect the directory to enable automatic scans.')
      if (!current()) return
      next = preservePreviews(next, workspace)
      scan.report({ phase: 'Saving project metadata' })
      let cacheFailed = !await persist(next, false, true)
      const failures: string[] = []
      if (next.mode === 'helper') {
        const previousProjects = new Map(workspace.projects.map(project => [project.id, project]))
        const changed = changedIds && new Set(changedIds)
        const queue = next.projects.filter(project => !changed || changed.has(project.id) || !previousProjects.has(project.id))
        for (const project of queue) {
          const hasPackages = project.hasPackageJson ?? !!project.dependencies?.length
          const checks = [
            { enabled: settings.watcherAudit && hasPackages, action: 'audit', report: 'audit', label: 'Scanning vulnerabilities' },
            { enabled: settings.watcherOutdated && hasPackages, action: 'outdated', report: 'outdated', label: 'Checking outdated packages' },
            { enabled: settings.watcherStorage, action: 'storage', report: 'storage', label: 'Measuring disk usage' },
            { enabled: settings.watcherReactDoctor && isReactProject(project), action: 'react-doctor', report: 'reactDoctor', label: 'Running React Doctor' },
            { enabled: settings.watcherLighthouse && isLighthouseProject(project), action: 'lighthouse', report: 'lighthouse', label: 'Running Lighthouse' },
          ] as const
          for (const check of checks) {
            if (!check.enabled) continue
            if (!current()) return
            progress(`${check.label} · ${project.name}`)
            scan.finish()
            scan = scans.begin(check.label, current, project)
            try {
              const update = await projectAction<Partial<RepoProject>>(project.id, check.action, {}, scan.report)
              if (!current()) return
              if (!update[check.report]) throw new Error('The helper returned no report.')
              if (check.action === 'audit' && update.audit) reportCriticalVulnerabilities({ ...project, audit: previousProjects.get(project.id)?.audit }, update.audit)
              next = { ...next, projects: next.projects.map(item => item.id === project.id ? { ...item, ...update } : item) }
              scan.report({ phase: 'Saving results' })
              cacheFailed = !await persist(next, false)
            } catch (error) {
              failures.push(`${project.name} (${check.action}): ${error instanceof Error ? error.message : 'Scan failed.'}`)
            }
          }
        }
      }
      if (!current()) return
      if (failures.length || cacheFailed) setNotice({ text: `Automatic scan finished${failures.length ? ` with ${failures.length} failed check(s). ${failures.slice(0, 3).join(' ')}` : '.'}${cacheFailed ? ' Results could not be saved in this browser.' : ''}`, error: true })
      return next
    } finally { scan.finish(); if (version === workspaceVersion.current) setBusy('') }
  }

  async function changePackages(project: RepoProject, name: string, body: unknown, updateLevel: 'minor' | 'patch' | undefined, version: number, report?: ScanProgressReporter) {
    if (!workspace) return
    const current = () => version === workspaceVersion.current
    const fixing = name === 'fix-vulnerability'
    let packageUpdate: PackageUpdate | undefined
    const failures: string[] = []
    report?.({ phase: fixing ? 'Applying a compatible vulnerability fix' : 'Updating dependencies' })
    try {
      const result = await projectAction<{ packageUpdate?: PackageUpdate }>(project.id, fixing ? name : 'update-packages', fixing ? body : { level: updateLevel })
      if (!result.packageUpdate) throw new Error('The helper did not return a package update result.')
      packageUpdate = result.packageUpdate
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'The package action could not be completed.')
    }
    if (!current()) return
    const repositoryId = packageWorkspaceId(project)
    const invalidate = (value: Workspace): Workspace => ({ ...value, projects: value.projects.map(item => packageWorkspaceId(item) === repositoryId ? {
      ...item, outdated: undefined, unused: undefined, audit: undefined, reactDoctor: undefined, lighthouse: undefined, storage: undefined,
      ...(item.id === project.id && packageUpdate ? { packageUpdate } : {}),
    } : item) })
    // A failed install may still change files. Never retain or restore old scores.
    const cleared = invalidate(workspace)
    let next = cleared
    let refreshed = false
    report?.({ phase: 'Refreshing project metadata' })
    try {
      if (!workspace.rootPath) throw new Error('No registered workspace path.')
      const scan = await scanWithHelper(workspace.rootPath, report)
      if (!current()) return
      next = invalidate(preservePreviews({ ...scan, mode: 'helper' }, cleared))
      refreshed = true
    } catch {
      failures.push('Metadata could not be refreshed. Resync before taking another package action.')
    }
    if (!current()) return
    report?.({ phase: 'Saving refreshed project metadata' })
    let cached = await persist(next, false)
    if (!current()) return
    if (fixing && packageUpdate && refreshed) {
      report?.({ phase: 'Rechecking vulnerabilities' })
      try {
        const result = await projectAction<{ audit?: PackageAudit }>(project.id, 'audit', {}, report)
        if (!current()) return
        if (!result.audit) throw new Error('The helper did not return an audit report.')
        const audit = result.audit
        reportCriticalVulnerabilities(project, audit)
        next = { ...next, projects: next.projects.map(item => item.id === project.id ? { ...item, audit } : item) }
        report?.({ phase: 'Saving the fresh vulnerability report' })
        cached = await persist(next, false)
      } catch (error) {
        failures.push(`The dependency update completed, but the vulnerability recheck failed: ${error instanceof Error ? error.message : 'Scan failed.'} Scan again to verify the result.`)
      }
    }
    if (!current()) return
    if (!cached) failures.push('Results could not be saved in this browser.')
    if (failures.length) setNotice({ text: failures.join(' '), error: true })
    else if (fixing) setNotice({ text: `Compatible dependency update completed for ${project.name}. Vulnerabilities were rescanned; review the current findings.` })
    else if (packageUpdate) setNotice({ text: packageUpdate.packages.length ? `Updated ${packageUpdate.packages.length} packages in ${project.name}.` : `No eligible ${updateLevel} updates found for ${project.name}.` })
  }

  async function action(project: RepoProject, name: string, body: unknown = {}) {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || lighthouseBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (name === 'lighthouse' && !isLighthouseProject(project)) return
    if (name === 'run-script') body = { ...(body as RunProjectScriptRequest), terminal: settings.terminal } satisfies RunProjectScriptRequest
    const updateLevel = name === 'update-minor' ? 'minor' : name === 'update-patches' ? 'patch' : undefined
    const version = ++workspaceVersion.current
    setBusy(`${project.id}:${name}`)
    const titles: Record<string, string> = { audit: 'Scanning vulnerabilities', outdated: 'Checking outdated packages', unused: 'Scanning unused packages', 'react-doctor': 'Running React Doctor', lighthouse: 'Running Lighthouse', screenshot: 'Capturing preview', storage: 'Measuring disk usage', 'fix-vulnerability': 'Fixing vulnerability' }
    const scan = titles[name] ? scans.begin(titles[name], () => version === workspaceVersion.current, project) : undefined
    try {
      if (updateLevel || name === 'fix-vulnerability') { await changePackages(project, name, body, updateLevel, version, scan?.report); return }
      if (name === 'logs') { const result = await api<{ logs: string }>(`/projects/${encodeURIComponent(project.id)}/logs`); setLogs(result.logs || 'No output yet. Start the dev server to see its logs.'); return }
      const result = await projectAction<Partial<RepoProject>>(project.id, name, body, scan?.report)
      if (name === 'screenshot' && result.screenshot) { scan?.report({ phase: 'Saving preview' }); result.screenshot = await cachePreview(result.screenshot) }
      if (version !== workspaceVersion.current) return
      if (name === 'lighthouse' && !result.lighthouse) throw new Error('The helper did not return a Lighthouse report.')
      if (name === 'react-doctor' && !result.reactDoctor) throw new Error('The helper did not return a React Doctor report.')
      if (name === 'audit' && result.audit) reportCriticalVulnerabilities(project, result.audit)
      scan?.report({ phase: 'Saving results' })
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
      if (name === 'react-doctor' && cached) setNotice({ text: `React Doctor scan completed for ${project.name}${result.reactDoctor?.warning || result.reactDoctor?.score === null ? ' with limited results. Open the React Doctor tab for details.' : '.'}` })
      if (name === 'lighthouse' && cached) setNotice({ text: `Lighthouse scan completed for ${project.name}${result.lighthouse?.warnings.length || result.lighthouse?.categories.length !== 4 || result.lighthouse?.categories.some(category => category.score === null) ? ' with limited results. Open the Lighthouse tab for details.' : '.'}` })
      if (name === 'open') setNotice({ text: 'Open request sent to your computer.' })
      if (name === 'run-script') setNotice({ text: 'Script sent to your terminal. Follow its progress and stop it there.' })
    } catch (error) { if (version === workspaceVersion.current) setNotice({ text: error instanceof Error ? error.message : 'The action could not be completed.', error: true }) }
    finally {
      scan?.finish()
      if (version === workspaceVersion.current) setBusy('')
    }
  }
  function packageBusy(project?: RepoProject) {
    if (project && auditBatch.isActive() && auditBatch.progress?.current?.id === project.id) return `${project.id}:audit`
    if (project && outdatedBatch.isActive() && outdatedBatch.progress?.current?.id === project.id) return `${project.id}:outdated`
    if (project && reactDoctorBatch.isActive() && reactDoctorBatch.progress?.current?.id === project.id) return `${project.id}:react-doctor`
    if (project && lighthouseBatch.isActive() && lighthouseBatch.progress?.current?.id === project.id) return `${project.id}:lighthouse`
    return busy
  }

  return { action, packageBusy, runAutomaticScan, scanProgress: scans.progress, previewBatch, auditBatch, outdatedBatch, reactDoctorBatch, lighthouseBatch, scanAllVulnerabilities, scanAllOutdated, scanAllReactDoctor, scanAllLighthouse, captureAllPreviews }
}
