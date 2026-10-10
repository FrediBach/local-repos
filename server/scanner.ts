import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { aiInstructionFileNames, extractReadmeIntro, normalizeGitOrigin, parsePackageJson } from '../src/lib/metadata'
import { matchesWorkspace, workspacePatterns } from '../src/lib/monorepo'
import type { RepoProject, ScanProgress, ScanProgressReporter, ScanResult } from '../src/types'
import { packageFingerprint, repositoryFingerprint } from './package-fingerprint'

const execFileAsync = promisify(execFile)
const MAX_METADATA_BYTES = 256 * 1024
const MAX_PROJECTS = 300
const ignoredDirectories = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', 'venv', '__pycache__'])
const markerStack: Record<string, string> = {
  'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'Cargo.toml': 'Rust',
  'go.mod': 'Go', 'composer.json': 'PHP', Gemfile: 'Ruby', 'pom.xml': 'Java',
  'build.gradle': 'Java', 'build.gradle.kts': 'Kotlin',
}

export interface RegisteredProject {
  project: RepoProject
  directory: string
  root: string
  workspaceDirectory?: string
  gitDirectory?: string
}

export class HelperError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'HelperError'
  }
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function readBounded(directory: string, filename: string): Promise<string | undefined> {
  const candidate = path.join(directory, filename)
  try {
    // Metadata symlinks must never read files outside this project.
    const resolved = await realpath(candidate)
    if (!isWithin(directory, resolved)) return undefined
    const metadataStat = await stat(resolved)
    if (!metadataStat.isFile() || metadataStat.size > MAX_METADATA_BYTES) return undefined
    const handle = await open(resolved, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_METADATA_BYTES) return undefined
      const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return bytesRead > MAX_METADATA_BYTES ? undefined : buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

async function git(directory: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: directory,
      timeout: 5_000,
      maxBuffer: 256 * 1024,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
    })
    return stdout.trim()
  } catch {
    return undefined
  }
}

async function readGit(directory: string): Promise<RepoProject['git']> {
  const [branch, lastCommit, origin, status] = await Promise.all([
    git(directory, ['symbolic-ref', '--short', 'HEAD']),
    git(directory, ['log', '-1', '--format=%H%x00%s%x00%cI']),
    git(directory, ['config', '--get', 'remote.origin.url']),
    git(directory, ['status', '--porcelain', '--untracked-files=normal']),
  ])
  const [commit, message, committedAt] = lastCommit?.split('\0') ?? []
  return { branch: branch || (commit ? 'Detached HEAD' : undefined), commit, message, committedAt, origin: origin ? normalizeGitOrigin(origin) : undefined, dirty: status === undefined ? undefined : status.length > 0 }
}

async function inspectProject(directory: string, root: string, names: string[], warnings: string[], onProgress?: ScanProgressReporter): Promise<RegisteredProject> {
  const filenames = new Set(names)
  const detail = path.relative(root, directory) || path.basename(directory)
  onProgress?.({ phase: 'Reading package metadata and lockfiles', detail })
  const fingerprint = await packageFingerprint(directory)
  const packageText = filenames.has('package.json') ? await readBounded(directory, 'package.json') : undefined
  let metadata: ReturnType<typeof parsePackageJson> | undefined
  if (packageText) {
    try {
      metadata = parsePackageJson(packageText)
    } catch {
      warnings.push(`${path.basename(directory)}: package.json could not be parsed.`)
    }
  }
  const readmeName = names.find((name) => /^readme(?:\.(?:md|mdx|markdown|txt))?$/i.test(name))
  onProgress?.({ phase: 'Reading the project README', detail })
  const readme = readmeName ? await readBounded(directory, readmeName) : undefined
  if (filenames.has('.git')) onProgress?.({ phase: 'Reading Git branch, commit, and working-tree status', detail })
  const gitInfo = filenames.has('.git') ? await readGit(directory) : undefined
  onProgress?.({ phase: 'Checking project instruction files', detail })
  const aiInstructionFiles: string[] = []
  for (const name of aiInstructionFileNames) {
    if (!filenames.has(name)) continue
    try {
      const resolved = await realpath(path.join(directory, name))
      if (isWithin(directory, resolved) && (await stat(resolved)).isFile()) aiInstructionFiles.push(name)
    } catch { /* A missing or inaccessible marker does not prevent scanning the project. */ }
  }
  const directoryStat = await stat(directory)
  const project: RepoProject = {
    id: createHash('sha256').update(directory).digest('hex').slice(0, 20),
    name: metadata?.name || path.basename(directory),
    dirName: path.basename(directory),
    relativePath: path.relative(root, directory) || '.',
    description: (readme && extractReadmeIntro(readme)) || metadata?.description || 'No project description yet.',
    readme,
    version: metadata?.version,
    author: metadata?.author,
    license: metadata?.license,
    homepage: metadata?.homepage,
    previewUrl: metadata?.previewUrl,
    aiInstructionFiles,
    stack: [...new Set([...(metadata?.stack ?? []), ...Object.entries(markerStack).filter(([name]) => filenames.has(name)).map(([, tech]) => tech), ...(filenames.has('components.json') ? ['shadcn/ui'] : []), ...(filenames.has('tsconfig.json') ? ['TypeScript'] : [])])],
    scripts: metadata?.scripts ?? {},
    dependencies: metadata?.dependencies ?? [],
    hasPackageJson: filenames.has('package.json'),
    packageFingerprint: fingerprint,
    packageManager: metadata?.packageManager ?? 'npm',
    git: gitInfo,
    updatedAt: gitInfo?.committedAt ?? directoryStat.mtime.toISOString(),
    scannedAt: new Date().toISOString(),
    dev: { status: 'stopped' },
  }
  if (!metadata?.packageManager || metadata.packageManager === 'npm') {
    if (filenames.has('pnpm-lock.yaml')) project.packageManager = 'pnpm'
    else if (filenames.has('yarn.lock')) project.packageManager = 'yarn'
    else if (filenames.has('bun.lock') || filenames.has('bun.lockb')) project.packageManager = 'bun'
  }
  return { project, directory, root, gitDirectory: filenames.has('.git') ? directory : undefined }
}

function looksLikeProject(names: string[]): boolean {
  const filenames = new Set(names)
  return filenames.has('.git') || filenames.has('package.json') || Object.keys(markerStack).some((name) => filenames.has(name))
}

export async function scanDirectory(input: unknown, onProgress?: ScanProgressReporter): Promise<{ result: ScanResult; registered: RegisteredProject[] }> {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096 || input.includes('\0')) {
    throw new HelperError('Enter the absolute path to your local repositories folder.')
  }
  if (!path.isAbsolute(input.trim())) throw new HelperError('Use an absolute folder path, for example /Users/you/Projects.')
  let root: string
  try {
    root = await realpath(input.trim())
    if (!(await stat(root)).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new HelperError('This folder does not exist or cannot be read. Check its path and permissions.')
  }
  const warnings: string[] = []
  onProgress?.({ phase: 'Discovering project folders', detail: path.basename(root) || root, completed: 0 })
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    throw new HelperError('This folder cannot be read. Check its permissions.')
  }
  const registered: RegisteredProject[] = []
  let inspectedFolders = 0
  let scheduledFolders = 1
  let truncated = false
  type WorkspaceContext = { entry: RegisteredProject; patterns: string[]; depth: number; automatic: boolean }
  const queue: { directory: string; entries: typeof entries; depth: number; workspace?: WorkspaceContext }[] = [{ directory: root, entries, depth: 0 }]
  while (queue.length && registered.length < MAX_PROJECTS && inspectedFolders < 500) {
    // Process small batches so large collections do not create hundreds of git
    // subprocesses simultaneously. Automatic discovery stops one level inside
    // a project; deeper traversal is restricted to declared workspaces.
    const batch = queue.splice(0, Math.min(8, 500 - inspectedFolders))
    inspectedFolders += batch.length
    const activeFolders = new Map<string, ScanProgress>()
    const inspected = await Promise.all(batch.map(async ({ directory, entries: currentEntries, depth, workspace }) => {
      const reportFolder = onProgress ? (progress: ScanProgress) => {
        activeFolders.set(directory, progress)
        // Keep the oldest unfinished folder visible. A quick sibling must not
        // conceal a long Git read, and completed siblings must never look busy.
        if (activeFolders.keys().next().value === directory) onProgress(progress)
      } : undefined
      reportFolder?.({ phase: 'Inspecting project folders', detail: path.relative(root, directory) || path.basename(directory) })
      try {
        const names = currentEntries.map((entry) => entry.name)
        let project: RegisteredProject | undefined
        const memberPath = workspace ? path.relative(workspace.entry.directory, directory).split(path.sep).join('/') : ''
        const directChild = workspace?.automatic && depth === workspace.depth + 1
        const declaredWorkspace = !!workspace && matchesWorkspace(memberPath, workspace.patterns)
        if (workspace ? (names.includes('package.json') && (directChild || declaredWorkspace)) || (directChild && names.includes('.git')) : looksLikeProject(names)) {
          try {
            project = await inspectProject(directory, root, names, warnings, reportFolder)
            if (workspace && !names.includes('.git')) {
              project.project.monorepo = { id: workspace.entry.project.id, name: workspace.entry.project.name, relativePath: workspace.entry.project.relativePath, packagePath: memberPath, declaredWorkspace }
              project.project.git ??= workspace.entry.project.git
              project.gitDirectory = workspace.entry.gitDirectory
              if (project.project.git?.committedAt) project.project.updatedAt = project.project.git.committedAt
              if (declaredWorkspace) {
                project.workspaceDirectory = workspace.entry.directory
                project.project.packageManager = workspace.entry.project.packageManager
                project.project.packageFingerprint = repositoryFingerprint(project.project.packageFingerprint!, workspace.entry.project.packageFingerprint)
              }
            }
            // A nested Git checkout is a separate repository, not a package of its parent.
            if (workspace && names.includes('.git')) return project
            if (!workspace || declaredWorkspace) {
              let patterns: string[] = []
              try {
                reportFolder?.({ phase: 'Checking workspace declarations', detail: project.project.relativePath })
                patterns = workspacePatterns(await readBounded(directory, 'package.json'), await readBounded(directory, 'pnpm-workspace.yaml'))
              } catch {
                warnings.push(`${path.relative(root, directory) || path.basename(directory)}: workspace declarations could not be read.`)
              }
              // Declared members may declare nested workspaces, but must not restart
              // automatic discovery at every package boundary.
              if (workspace && !patterns.length) return project
              workspace = { entry: project, patterns, depth, automatic: !workspace }
            }
            // Undeclared packages do not expand discovery. Keep the outer context
            // so they cannot hide deeper members declared by the repository root.
          } catch {
            warnings.push(`${path.relative(root, directory)}: this folder could not be read.`)
            return project
          }
        }
        if (workspace ? depth - workspace.depth >= 8 : depth >= 2) return project
        const candidates = currentEntries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !ignoredDirectories.has(entry.name))
        for (const child of candidates) {
          if (workspace && !(workspace.automatic && depth === workspace.depth) && !matchesWorkspace(path.relative(workspace.entry.directory, path.join(directory, child.name)).split(path.sep).join('/'), workspace.patterns, true)) continue
          // Reserve before awaiting filesystem access so concurrent groups cannot
          // all claim the same remaining budget or silently drop overflow.
          if (scheduledFolders >= 500) {
            truncated = true
            break
          }
          scheduledFolders += 1
          try {
            const childDirectory = await realpath(path.join(directory, child.name))
            if (!isWithin(root, childDirectory)) continue
            queue.push({ directory: childDirectory, entries: await readdir(childDirectory, { withFileTypes: true }), depth: depth + 1, workspace })
          } catch {
            warnings.push(`${child.name}: this folder could not be read.`)
          }
        }
        return project
      } finally {
        const wasVisible = activeFolders.keys().next().value === directory
        activeFolders.delete(directory)
        const next = activeFolders.values().next().value
        if (wasVisible && next) onProgress?.(next)
      }
    }))
    for (const project of inspected) if (project && registered.length < MAX_PROJECTS) registered.push(project)
    onProgress?.({ phase: 'Discovering project folders', detail: `${inspectedFolders} folders checked · ${registered.length} projects found`, completed: inspectedFolders })
  }
  if (truncated || queue.length || registered.length >= MAX_PROJECTS) warnings.push(`Scan limited to 500 folders and ${MAX_PROJECTS} projects. Choose a smaller collection to see the rest.`)
  registered.sort((a, b) => a.project.name.localeCompare(b.project.name))
  onProgress?.({ phase: 'Organizing projects and workspace packages', detail: `${registered.length} projects found` })
  for (const entry of registered) {
    const count = registered.filter(child => child.project.monorepo?.id === entry.project.id).length
    if (count) entry.project.workspacePackageCount = count
  }
  return {
    result: { rootName: path.basename(root) || root, rootPath: root, projects: registered.map((entry) => entry.project), syncedAt: new Date().toISOString(), warnings },
    registered,
  }
}

export class ProjectRegistry {
  private readonly projects = new Map<string, RegisteredProject>()

  related(id: string): RegisteredProject[] {
    const entry = this.lookup(id)
    const directory = entry.workspaceDirectory ?? entry.directory
    return [...this.projects.values()].filter(other => (other.workspaceDirectory ?? other.directory) === directory)
  }

  register(entries: RegisteredProject[], scopeBusy?: (id: string) => boolean): void {
    // Validate the entire scan before changing any live object. Membership paths
    // belong to the index; a narrower scan cannot discard known workspace scope.
    for (const entry of entries) {
      const previous = this.projects.get(entry.project.id)
      if (!previous) continue
      if (previous.workspaceDirectory && !entry.workspaceDirectory && entry.gitDirectory !== entry.directory && previous.workspaceDirectory !== entry.root && isWithin(previous.workspaceDirectory, entry.root)) {
        entry.workspaceDirectory = previous.workspaceDirectory
        entry.project.monorepo = previous.project.monorepo
      }
      if (previous.gitDirectory && !entry.gitDirectory && previous.gitDirectory !== entry.root && isWithin(previous.gitDirectory, entry.root)) entry.gitDirectory = previous.gitDirectory
      const nextWorkspace = entries.find(other => other.directory === entry.workspaceDirectory)
      const nextWorkspaceKnown = nextWorkspace && this.projects.has(nextWorkspace.project.id)
      if ((previous.workspaceDirectory !== entry.workspaceDirectory || previous.gitDirectory !== entry.gitDirectory) && (scopeBusy?.(entry.project.id) || (nextWorkspaceKnown && scopeBusy?.(nextWorkspace.project.id)))) {
        throw new HelperError('SCOPE_CONFLICT: Workspace context changed while the project is busy. Rescan when idle.', 409)
      }
      if (isWithin(previous.root, entry.root)) entry.root = previous.root
      else if (!isWithin(entry.root, previous.root)) throw new HelperError('SCOPE_CONFLICT: Conflicting project roots.', 409)
    }
    for (const entry of entries) {
      const previous = this.projects.get(entry.project.id)
      if (previous) {
        const dev = previous.project.dev
        const screenshot = previous.project.screenshot
        const preview = previous.project.preview
        const storage = entry.project.storage ?? previous.project.storage
        const audit = entry.project.audit ?? previous.project.audit
        const outdated = entry.project.outdated ?? previous.project.outdated
        const unused = entry.project.unused ?? previous.project.unused
        const reactDoctor = entry.project.reactDoctor ?? previous.project.reactDoctor
        const lighthouse = entry.project.lighthouse ?? previous.project.lighthouse
        Object.assign(previous.project, entry.project, { monorepo: entry.project.monorepo, workspacePackageCount: entry.project.workspacePackageCount, dev, screenshot, preview, storage, audit, outdated, unused, reactDoctor, lighthouse })
        entry.project = previous.project
      }
      this.projects.set(entry.project.id, entry)
    }
  }

  lookup(id: string): RegisteredProject {
    const entry = this.projects.get(id)
    if (!entry) throw new HelperError('Project not found. Sync its folder again.', 404)
    return entry
  }

  async get(id: string): Promise<RegisteredProject> {
    const entry = this.lookup(id)
    let current: string
    try {
      current = await realpath(entry.directory)
    } catch {
      throw new HelperError('This project folder has moved or is no longer accessible. Sync again.', 404)
    }
    if (current !== entry.directory || !isWithin(entry.root, current)) {
      throw new HelperError('The project path changed. Sync its folder again before taking an action.', 403)
    }
    if (entry.workspaceDirectory && (await realpath(entry.workspaceDirectory) !== entry.workspaceDirectory || !isWithin(entry.root, entry.workspaceDirectory))) {
      throw new HelperError('The workspace path changed. Sync again before taking an action.', 403)
    }
    if (entry.gitDirectory && (await realpath(entry.gitDirectory) !== entry.gitDirectory || !isWithin(entry.root, entry.gitDirectory))) throw new HelperError('The Git path changed. Sync again before taking an action.', 403)
    return entry
  }
}
