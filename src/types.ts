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
}
export interface PackageAudit {
  manager: RepoProject['packageManager']
  scannedAt: string
  counts: Record<AuditSeverity, number>
  findings: AuditFinding[]
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

export interface RepoProject {
  id: string
  name: string
  dirName: string
  relativePath: string
  monorepo?: { id: string; name: string; relativePath: string; packagePath: string }
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
