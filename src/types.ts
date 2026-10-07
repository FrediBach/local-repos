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
  stack: string[]
  scripts: Record<string, string>
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
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
