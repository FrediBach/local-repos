export type PreviewMode = 'auto' | 'local' | 'website'
export type PreviewKind = 'screenshot' | 'og-image' | 'logo' | 'favicon'

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
