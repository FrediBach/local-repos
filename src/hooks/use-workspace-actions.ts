import type { RefObject } from 'react'
import { usePreviewBatch } from './use-preview-batch'
import { useAuditBatch } from './use-audit-batch'
import { useOutdatedBatch } from './use-outdated-batch'
import { useReactDoctorBatch } from './use-react-doctor-batch'
import { useTestCoverageBatch } from './use-test-coverage-batch'
import { api, projectAction, scanWithHelper } from '@/lib/api'
import { canReadDirectory, scanDirectory } from '@/lib/filesystem'
import { useSettings } from './use-settings'
import { cachePreview, preservePreviews } from '@/lib/workspace'
import { isReactProject } from '@/lib/react-doctor'
import { isCoverageProject } from '@/lib/test-coverage'
import type { PackageAudit, PackageOutdated, ReactDoctorReport, TestCoverageReport, RepoProject, Workspace } from '@/types'

interface Options {
  workspace?: Workspace
  busy: string
  workspaceVersion: RefObject<number>
  setBusy: (busy: string) => void
  setLogs: (logs: string) => void
  setNotice: (notice: { text: string; error?: boolean } | undefined) => void
  setConnectOpen: (open: boolean) => void
  persist: (workspace: Workspace, reportError?: boolean) => Promise<boolean>
  reportCriticalVulnerabilities: (project: RepoProject, audit: PackageAudit) => void
}

export function useWorkspaceActions({ workspace, busy, workspaceVersion, setBusy, setLogs, setNotice, setConnectOpen, persist, reportCriticalVulnerabilities }: Options) {
  const { settings } = useSettings()
  const previewBatch = usePreviewBatch()
  const auditBatch = useAuditBatch()
  const outdatedBatch = useOutdatedBatch()
  const reactDoctorBatch = useReactDoctorBatch()
  const testCoverageBatch = useTestCoverageBatch()

  async function scanAllVulnerabilities() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-audit')
    setNotice(undefined)
    previewBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    testCoverageBatch.dismiss()
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
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-outdated')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    reactDoctorBatch.dismiss()
    testCoverageBatch.dismiss()
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

  async function scanAllReactDoctor() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const projects = workspace.projects.filter(isReactProject)
    if (!projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-react-doctor')
    testCoverageBatch.dismiss()
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    try {
      await reactDoctorBatch.run(projects, async (project, isCurrent) => {
        const result = await projectAction<{ reactDoctor?: ReactDoctorReport }>(project.id, 'react-doctor')
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.reactDoctor) throw new Error('The helper did not return a React Doctor report.')
        const reactDoctor = result.reactDoctor
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, reactDoctor } : current) }
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, report: reactDoctor }
      })
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function scanAllTestCoverage() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const projects = workspace.projects.filter(isCoverageProject)
    if (!projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-test-coverage')
    setNotice(undefined)
    previewBatch.dismiss()
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    try {
      await testCoverageBatch.run(projects, async (project, isCurrent) => {
        const result = await projectAction<{ testCoverage?: TestCoverageReport }>(project.id, 'test-coverage')
        if (!isCurrent() || version !== workspaceVersion.current) return
        if (!result.testCoverage) throw new Error('The helper did not return a test coverage report.')
        const testCoverage = result.testCoverage
        nextWorkspace = { ...nextWorkspace, projects: nextWorkspace.projects.map(current => current.id === project.id ? { ...current, testCoverage } : current) }
        const cached = await persist(nextWorkspace, false)
        return { cacheWarning: !cached, report: testCoverage }
      })
    } finally {
      if (version === workspaceVersion.current) setBusy('')
    }
  }

  async function captureAllPreviews() {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    if (!workspace.projects.length) return
    const version = ++workspaceVersion.current
    let nextWorkspace = workspace
    setBusy('batch-capture')
    setNotice(undefined)
    auditBatch.dismiss()
    outdatedBatch.dismiss()
    reactDoctorBatch.dismiss()
    testCoverageBatch.dismiss()
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

  async function runAutomaticScan(changedIds: string[] | undefined, isCurrent: () => boolean, progress: (message: string) => void) {
    if (!workspace || busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
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

  async function action(project: RepoProject, name: string, body: unknown = {}) {
    if (busy || previewBatch.isActive() || auditBatch.isActive() || outdatedBatch.isActive() || reactDoctorBatch.isActive() || testCoverageBatch.isActive()) return
    if (workspace?.mode !== 'helper') { setConnectOpen(true); return }
    const updateLevel = name === 'update-minor' ? 'minor' : name === 'update-patches' ? 'patch' : undefined
    const version = ++workspaceVersion.current
    setBusy(`${project.id}:${name}`)
    try {
      if (name === 'logs') { const result = await api<{ logs: string }>(`/projects/${encodeURIComponent(project.id)}/logs`); setLogs(result.logs || 'No output yet. Start the dev server to see its logs.'); return }
      const result = await projectAction<Partial<RepoProject>>(project.id, updateLevel ? 'update-packages' : name, updateLevel ? { level: updateLevel } : body)
      if (name === 'screenshot' && result.screenshot) result.screenshot = await cachePreview(result.screenshot)
      if (version !== workspaceVersion.current) return
      if (name === 'test-coverage' && !result.testCoverage) throw new Error('The helper did not return a test coverage report.')
      if (name === 'react-doctor' && !result.reactDoctor) throw new Error('The helper did not return a React Doctor report.')
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
      if (name === 'react-doctor' && cached) setNotice({ text: `React Doctor scan completed for ${project.name}${result.reactDoctor?.warning || result.reactDoctor?.score === null ? ' with limited results. Open the React Doctor tab for details.' : '.'}` })
      if (name === 'test-coverage' && cached) setNotice({ text: `Coverage scan completed for ${project.name}${result.testCoverage?.source === 'existing-report' ? ' using an existing report.' : result.testCoverage?.warning || result.testCoverage?.exitCode ? ' with scan notes. Open the Coverage tab for details.' : '.'}` })
      if (updateLevel && result.packageUpdate) setNotice({ text: result.packageUpdate.packages.length ? `Updated ${result.packageUpdate.packages.length} packages in ${project.name}.` : `No eligible ${updateLevel} updates found for ${project.name}.` })
      if (name === 'open') setNotice({ text: 'Open request sent to your computer.' })
      if (name === 'run-script') setNotice({ text: 'Script sent to your terminal. Follow its progress and stop it there.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'The action could not be completed.', error: true }) }
    finally {
      if (updateLevel && workspace.rootPath) {
        const repositoryId = project.monorepo?.id ?? project.id
        const cleared = { ...workspace, projects: workspace.projects.map(item => (item.monorepo?.id ?? item.id) === repositoryId ? { ...item, outdated: undefined, unused: undefined, audit: undefined, reactDoctor: undefined, testCoverage: undefined, storage: undefined } : item) }
        try {
          const refreshed = await scanWithHelper(workspace.rootPath)
          if (version === workspaceVersion.current) await persist(preservePreviews({ ...refreshed, mode: 'helper' }, cleared), false)
        } catch { await persist(cleared, false); setNotice({ text: 'Package action finished, but metadata could not be refreshed. Resync before taking another package action.', error: true }) }
      }
      setBusy('')
    }
  }
  function packageBusy(project?: RepoProject) {
    if (project && auditBatch.isActive() && auditBatch.progress?.current?.id === project.id) return `${project.id}:audit`
    if (project && outdatedBatch.isActive() && outdatedBatch.progress?.current?.id === project.id) return `${project.id}:outdated`
    if (project && reactDoctorBatch.isActive() && reactDoctorBatch.progress?.current?.id === project.id) return `${project.id}:react-doctor`
    if (project && testCoverageBatch.isActive() && testCoverageBatch.progress?.current?.id === project.id) return `${project.id}:test-coverage`
    return busy
  }

  return { action, packageBusy, runAutomaticScan, previewBatch, auditBatch, outdatedBatch, reactDoctorBatch, testCoverageBatch, scanAllVulnerabilities, scanAllOutdated, scanAllReactDoctor, scanAllTestCoverage, captureAllPreviews }
}
