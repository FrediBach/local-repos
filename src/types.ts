import type { DesktopAppId, TerminalId } from './lib/desktop-apps'

export interface OpenProjectRequest {
  app: DesktopAppId | 'folder'
}

export interface RunProjectScriptRequest {
  name: string
  command: string
  terminal?: TerminalId
}

export type PreviewMode = 'auto' | 'local' | 'website'
export type PreviewKind = 'screenshot' | 'og-image' | 'logo' | 'favicon'

export interface GitCommit {
  hash: string
  author: string
  email: string
  committedAt: string
  message: string
}
export interface GitHistoryQuery {
  branch?: string
  author?: string
  offset?: number
}
export interface GitHistory {
  available: boolean
  branches: { ref: string; name: string; remote: boolean }[]
  authors: { name: string; email: string }[]
  commits: GitCommit[]
  total: number
  offset: number
  hasMore: boolean
  activity: { date: string; count: number }[]
  from: string
  to: string
  shallow: boolean
}

export interface GitDayQuery {
  from: string
  to: string
}
export interface GitDayCommit extends GitCommit {
  /** Branches containing the commit now; Git does not record its original branch. */
  branches: GitHistory['branches']
}
export interface GitDay {
  available: boolean
  shallow: boolean
  commits: GitDayCommit[]
}

export interface GitPushStatus {
  available: boolean
  hasOrigin: boolean
  originRefsKnown: boolean
  unpushedCommits: number
  dirty: boolean
  shallow: boolean
  checkedAt: string
}

export interface ProjectDependency {
  name: string
  version: string
  kind: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
}

export interface ProjectStorage {
  totalBytes: number
  nodeModulesBytes: number
  hasNodeModules: boolean
  measuredAt: string
  partial: boolean
}

export type AuditSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical'
export interface AuditFinding {
  name: string
  severity: AuditSeverity
  range?: string
  title: string
  url?: string
  fixAvailable?: boolean
  direct?: boolean
  identifiers?: string[]
  suppression?: { source: string; ids: string[]; reason?: string }
}
export interface PackageAudit {
  manager: RepoProject['packageManager']
  scannedAt: string
  counts: Record<AuditSeverity, number>
  findings: AuditFinding[]
  /** Counts before project ignore rules; counts above contain active findings. */
  originalCounts?: Record<AuditSeverity, number>
  warnings?: string[]
}

export type OutdatedLevel = 'current' | 'low' | 'moderate' | 'high'
export interface PackageUpdate {
  level: 'minor' | 'patch'
  updatedAt: string
  packages: { name: string; from: string; to: string }[]
  skipped: { name: string; reason: string }[]
}
export interface OutdatedFinding {
  name: string
  current: string
  wanted?: string
  latest: string
  kind?: ProjectDependency['kind']
  change: 'major' | 'minor' | 'patch' | 'prerelease'
  majorGap: number
  score: number
}
export interface PackageOutdated {
  manager: RepoProject['packageManager']
  scannedAt: string
  findings: OutdatedFinding[]
  score: number
  level: OutdatedLevel
  skipped?: { name: string; reason: string }[]
}

export interface PackageUnused {
  scannedAt: string
  knipVersion: string
  findings: (ProjectDependency & { line?: number })[]
  warning?: string
}

export interface ReactDoctorFinding {
  filePath: string
  line: number
  column: number
  rule: string
  plugin: string
  severity: 'error' | 'warning'
  message: string
  help: string
  category: string
  url?: string
}

export interface ReactDoctorReport {
  scannedAt: string
  version: string
  score: number | null
  label: string
  findings: ReactDoctorFinding[]
  warning?: string
}

export type LighthouseCategoryId = 'performance' | 'accessibility' | 'best-practices' | 'seo'

export interface LighthouseCategory {
  id: LighthouseCategoryId
  title: string
  /** Lighthouse category score on a 0–100 scale; null means unavailable. */
  score: number | null
}

export interface LighthouseAudit {
  id: string
  title: string
  description: string
  /** Individual audit score on Lighthouse's original 0–1 scale. */
  score: number | null
  scoreDisplayMode: string
  categories: LighthouseCategoryId[]
  displayValue?: string
  numericValue?: number
  numericUnit?: string
  explanation?: string
  /** Bounded, text-only diagnostic rows; never executable report HTML. */
  details?: {
    headings: { key: string; label: string }[]
    items: Record<string, string>[]
    omitted?: number
  }
}

export interface LighthouseReport {
  scannedAt: string
  version: string
  requestedUrl: string
  url: string
  formFactor: 'mobile' | 'desktop'
  categories: LighthouseCategory[]
  audits: LighthouseAudit[]
  warnings: string[]
}

export interface RepoProject {
  id: string
  name: string
  dirName: string
  relativePath: string
  monorepo?: {
    id: string; name: string; relativePath: string; packagePath: string
    /** False for discovered subprojects that do not share a declared package workspace. */
    declaredWorkspace?: boolean
  }
  workspacePackageCount?: number
  description: string
  readme?: string
  version?: string
  author?: string
  license?: string
  homepage?: string
  previewUrl?: string
  aiInstructionFiles?: string[]
  stack: string[]
  /** User labels, attached from browser preferences rather than repository scans. */
  tags?: string[]
  scripts: Record<string, string>
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  dependencies?: ProjectDependency[]
  hasPackageJson?: boolean
  packageFingerprint?: string
  storage?: ProjectStorage
  audit?: PackageAudit
  outdated?: PackageOutdated
  unused?: PackageUnused
  reactDoctor?: ReactDoctorReport
  lighthouse?: LighthouseReport
  packageUpdate?: PackageUpdate
  git?: {
    branch?: string
    commit?: string
    message?: string
    committedAt?: string
    origin?: string
    dirty?: boolean
  }
  updatedAt?: string
  scannedAt: string
  screenshot?: string
  preview?: {
    url?: string
    source: 'local' | 'configured' | 'package' | 'github' | 'repository'
    kind?: PreviewKind
    assetUrl?: string
    assetPath?: string
    capturedAt: string
  }
  dev?: { status: 'stopped' | 'starting' | 'running' | 'error'; url?: string; error?: string }
}

export interface ScanProgress {
  phase: string
  detail?: string
  completed?: number
  total?: number
}

export type ScanProgressReporter = (progress: ScanProgress) => void

export interface ScanResult {
  rootName: string
  rootPath?: string
  projects: RepoProject[]
  syncedAt: string
  warnings?: string[]
}

export interface Workspace extends ScanResult {
  mode: 'browser' | 'helper'
  handle?: FileSystemDirectoryHandle
}
