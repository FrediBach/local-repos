import { matchesWorkspace, workspacePatterns } from './monorepo'
import type { RepoProject, ScanResult } from '../types'
import { aiInstructionFileNames, extractReadmeIntro, parseGitConfig, parseGitHead, parseGitLog, parsePackageJson } from './metadata'

const ignoredDirectories = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', 'venv', '__pycache__'])
const markerStack: Record<string, string> = {
  'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'Cargo.toml': 'Rust',
  'go.mod': 'Go', 'composer.json': 'PHP', Gemfile: 'Ruby', 'pom.xml': 'Java',
  'build.gradle': 'Java', 'build.gradle.kts': 'Kotlin',
}
const MAX_FILE_SIZE = 128 * 1024

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function chooseDirectory(): Promise<FileSystemDirectoryHandle> {
  const browser = window as typeof window & {
    showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<FileSystemDirectoryHandle>
  }
  if (!browser.showDirectoryPicker) {
    throw new Error('Folder access requires Chrome or Edge on desktop. You can also connect the local helper in this browser.')
  }
  return browser.showDirectoryPicker({ id: 'local-repos-workspace', mode: 'read' })
}

export async function canReadDirectory(handle: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  const directory = handle
  if (!directory.queryPermission) return true
  const permission = await directory.queryPermission({ mode: 'read' })
  if (permission === 'granted') return true
  if (request && directory.requestPermission) return await directory.requestPermission({ mode: 'read' }) === 'granted'
  return false
}

function missing(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
}

async function readFile(directory: FileSystemDirectoryHandle, path: string, tail = false): Promise<{ text: string; modifiedAt: number } | undefined> {
  try {
    const segments = path.split('/')
    const name = segments.pop()!
    let parent = directory
    for (const segment of segments) parent = await parent.getDirectoryHandle(segment)
    const handle = await parent.getFileHandle(name)
    const file = await handle.getFile()
    const content = tail && file.size > MAX_FILE_SIZE
      ? file.slice(file.size - MAX_FILE_SIZE)
      : file.slice(0, MAX_FILE_SIZE)
    return { text: await content.text(), modifiedAt: file.lastModified }
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

async function readGit(directory: FileSystemDirectoryHandle, entries: Map<string, FileSystemHandle>, warn: (message: string) => void): Promise<RepoProject['git']> {
  const gitEntry = entries.get('.git')
  if (!gitEntry) return undefined
  if (gitEntry.kind === 'file') {
    warn('Linked worktree Git metadata requires the local helper.')
    return undefined
  }
  try {
    const gitDirectory = await directory.getDirectoryHandle('.git')
    const [head, config, log] = await Promise.all([
      readFile(gitDirectory, 'HEAD'), readFile(gitDirectory, 'config'), readFile(gitDirectory, 'logs/HEAD', true),
    ])
    const parsedHead = parseGitHead(head?.text ?? '')
    let commit = parsedHead.commit
    const ref = head?.text.trim().match(/^ref:\s+(refs\/[\w./-]+)$/)?.[1]
    if (ref && !ref.split('/').includes('..')) {
      commit = (await readFile(gitDirectory, ref))?.text.trim()
      if (!commit) {
        const packed = await readFile(gitDirectory, 'packed-refs')
        commit = packed?.text.split(/\r?\n/).find((line) => line.split(' ')[1] === ref)?.split(' ')[0]
      }
    }
    const parsedLog = parseGitLog(log?.text ?? '', commit)
    return {
      ...parsedHead,
      commit: commit || parsedLog.commit,
      message: parsedLog.message,
      committedAt: parsedLog.committedAt,
      origin: parseGitConfig(config?.text ?? ''),
    }
  } catch {
    warn('Git metadata could not be read. Connect the local helper for full Git details.')
    return undefined
  }
}

/** Read selected folders only. No scripts, subprocesses or filesystem writes. */
export async function scanDirectory(handle: FileSystemDirectoryHandle): Promise<ScanResult> {
  if (!await canReadDirectory(handle)) throw new Error('Folder access has expired. Reconnect this folder to sync it again.')
  const projects: RepoProject[] = []
  const warnings: string[] = []
  const syncedAt = new Date().toISOString()
  let inspected = 0
  let limitWarning = false
  const warn = (message: string) => { if (warnings.length < 20 && !warnings.includes(message)) warnings.push(message) }

  type WorkspaceContext = { project: RepoProject; patterns: string[]; depth: number }
  async function visit(directory: FileSystemDirectoryHandle, relativePath: string, depth: number, workspace?: WorkspaceContext): Promise<void> {
    if (inspected >= 500 || projects.length >= 250) {
      if (!limitWarning) warn('Scan limited to 500 folders and 250 projects. Choose a smaller parent folder to see the rest.')
      limitWarning = true
      return
    }
    inspected += 1
    let entries: Map<string, FileSystemHandle>
    try {
      entries = new Map()
      for await (const entry of directory.values()) entries.set(entry.name, entry)
    } catch (error) {
      if (depth === 0) throw error
      warn(`${relativePath}: folder could not be read.`)
      return
    }
    const isProject = entries.has('.git') || entries.has('package.json') || Object.keys(markerStack).some((name) => entries.has(name))
    const memberPath = workspace ? relativePath.slice(workspace.project.relativePath === '.' ? 0 : workspace.project.relativePath.length + 1) : ''
    if (workspace ? entries.has('package.json') && matchesWorkspace(memberPath, workspace.patterns) : isProject) {
      let pkg: ReturnType<typeof parsePackageJson> | undefined
      let modifiedAt = 0
      try {
        const packageFile = await readFile(directory, 'package.json')
        if (packageFile) { pkg = parsePackageJson(packageFile.text); modifiedAt = packageFile.modifiedAt }
      } catch { warn(`${relativePath}: package.json could not be read.`) }
      const readmeName = [...entries.keys()].find((name) => /^readme(?:\.(?:md|markdown|txt|rst))?$/i.test(name))
      let readme: string | undefined
      if (readmeName) {
        try {
          const readmeFile = await readFile(directory, readmeName)
          readme = readmeFile?.text
          modifiedAt = Math.max(modifiedAt, readmeFile?.modifiedAt ?? 0)
        } catch { warn(`${relativePath}: README could not be read.`) }
      }
      const stack = [...new Set([...(pkg?.stack ?? []), ...Object.entries(markerStack).filter(([name]) => entries.has(name)).map(([, name]) => name)])]
      if (entries.has('components.json') && !stack.includes('shadcn/ui')) stack.push('shadcn/ui')
      if (entries.has('tsconfig.json') && !stack.includes('TypeScript')) stack.push('TypeScript')
      const packageManager = entries.has('bun.lockb') || entries.has('bun.lock') ? 'bun'
        : entries.has('pnpm-lock.yaml') ? 'pnpm'
          : entries.has('yarn.lock') ? 'yarn' : pkg?.packageManager ?? 'npm'
      const git = await readGit(directory, entries, (message) => warn(`${relativePath}: ${message}`))
      const project: RepoProject = {
        id: `browser:${handle.name}/${relativePath}`,
        name: pkg?.name ?? directory.name,
        dirName: directory.name,
        relativePath,
        description: extractReadmeIntro(readme ?? '') || pkg?.description || '',
        readme,
        version: pkg?.version,
        author: pkg?.author,
        license: pkg?.license,
        homepage: pkg?.homepage,
        previewUrl: pkg?.previewUrl,
        aiInstructionFiles: aiInstructionFileNames.filter(name => entries.get(name)?.kind === 'file'),
        stack,
        scripts: pkg?.scripts ?? {},
        dependencies: pkg?.dependencies ?? [],
        packageManager: workspace?.project.packageManager ?? packageManager,
        git: git ?? workspace?.project.git,
        ...(workspace ? { monorepo: { id: workspace.project.id, name: workspace.project.name, relativePath: workspace.project.relativePath, packagePath: memberPath } } : {}),
        updatedAt: git?.committedAt ?? (modifiedAt ? new Date(modifiedAt).toISOString() : undefined),
        scannedAt: syncedAt,
      }
      projects.push(project)
      try {
        const patterns = workspacePatterns((await readFile(directory, 'package.json'))?.text, (await readFile(directory, 'pnpm-workspace.yaml'))?.text)
        if (!patterns.length) return
        workspace = { project, patterns, depth }
      } catch { warn(`${relativePath}: workspace declarations could not be read.`); return }
    }
    if (workspace ? depth - workspace.depth >= 8 : depth >= 2) return
    const children = [...entries.values()].filter((entry) => entry.kind === 'directory' && !entry.name.startsWith('.') && !ignoredDirectories.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const childPath = relativePath === '.' ? child.name : `${relativePath}/${child.name}`
      const workspacePath = workspace ? childPath.slice(workspace.project.relativePath === '.' ? 0 : workspace.project.relativePath.length + 1) : ''
      if (workspace && !matchesWorkspace(workspacePath, workspace.patterns, true)) continue
      await visit(child as FileSystemDirectoryHandle, childPath, depth + 1, workspace)
    }
  }

  await visit(handle, '.', 0)
  for (const project of projects) {
    const count = projects.filter(child => child.monorepo?.id === project.id).length
    if (count) project.workspacePackageCount = count
  }
  return { rootName: handle.name, projects: projects.sort((a, b) => a.name.localeCompare(b.name)), syncedAt, warnings: warnings.length ? warnings : undefined }
}
