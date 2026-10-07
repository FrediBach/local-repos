export type PreviewMode = 'auto' | 'local' | 'website'
export type PreviewKind = 'screenshot' | 'og-image' | 'logo' | 'favicon'

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

export interface RepoProject {
  id: string
  name: string
  dirName: string
  relativePath: string
  description: string
  readme?: string
  version?: string
  author?: string
  license?: string
  homepage?: string
  previewUrl?: string
  stack: string[]
  scripts: Record<string, string>
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  dependencies?: ProjectDependency[]
  storage?: ProjectStorage
  audit?: PackageAudit
  outdated?: PackageOutdated
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
