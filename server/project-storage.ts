import { lstat, opendir, realpath, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import type { ProjectStorage, ScanProgressReporter } from '../src/types'
import { HelperError } from './scanner'

const MAX_ENTRIES = 250_000
const MAX_DEPTH = 128
const MAX_SCAN_MS = 20_000

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function sameEntry(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino
}

function allocatedBytes(info: Stats): number {
  // POSIX reports allocated blocks in units of 512 bytes, including sparse
  // files. Fall back to logical length on platforms without block counts.
  return Number.isFinite(info.blocks) && info.blocks >= 0 ? info.blocks * 512 : info.size
}

async function projectDirectory(directory: string): Promise<Stats> {
  if (!path.isAbsolute(directory) || path.resolve(directory) === path.parse(directory).root) {
    throw new HelperError('Choose a project folder before measuring or removing dependencies.', 400)
  }
  try {
    const info = await lstat(directory)
    if (info.isSymbolicLink() || await realpath(directory) !== path.resolve(directory)) {
      throw new HelperError('The project path changed. Sync its folder again before taking an action.', 403)
    }
    if (!info.isDirectory()) throw new Error('Not a directory')
    return info
  } catch (error) {
    if (error instanceof HelperError) throw error
    throw new HelperError('This project folder is no longer accessible. Check its path and permissions, then sync again.', 404)
  }
}

/** Allocated bytes, with symlink targets excluded and hard links counted once. */
export async function measureProjectStorage(directory: string, onProgress?: ScanProgressReporter): Promise<ProjectStorage> {
  onProgress?.({ phase: 'Checking the project directory' })
  const rootInfo = await projectDirectory(directory)
  const result: ProjectStorage = {
    totalBytes: 0,
    nodeModulesBytes: 0,
    hasNodeModules: false,
    measuredAt: new Date().toISOString(),
    partial: false,
  }
  const deadline = Date.now() + MAX_SCAN_MS
  const counted = new Set<string>()
  const countedModules = new Set<string>()
  let entries = 0
  let lastProgress = 0
  let phase = 'Measuring node_modules'
  const reportEntries = () => onProgress?.({ phase, detail: `${entries.toLocaleString('en-US')} filesystem entries checked` })
  const count = (info: Stats, modules: boolean) => {
    const key = `${info.dev}:${info.ino}`
    if (!counted.has(key)) {
      counted.add(key)
      result.totalBytes += allocatedBytes(info)
    }
    if (modules && !countedModules.has(key)) {
      countedModules.add(key)
      result.nodeModulesBytes += allocatedBytes(info)
    }
  }
  const exhausted = () => entries >= MAX_ENTRIES || Date.now() >= deadline
  const walk = async (filename: string, depth: number, modules: boolean, known?: Stats): Promise<void> => {
    if (exhausted()) { result.partial = true; return }
    entries += 1
    if (onProgress && Date.now() - lastProgress >= 250) {
      lastProgress = Date.now()
      reportEntries()
    }
    let info: Stats
    try { info = known ?? await lstat(filename) }
    catch { result.partial = true; return }
    count(info, modules)
    // lstat never follows symlinks, including links to parent directories and
    // external pnpm stores. Count the link itself, not the linked data.
    if (!info.isDirectory() || info.isSymbolicLink()) return
    if (depth >= MAX_DEPTH) { result.partial = true; return }
    try {
      // Revalidate before descending, since folders may change during a scan.
      const current = await lstat(filename)
      if (!sameEntry(info, current) || current.isSymbolicLink() || await realpath(filename) !== filename) {
        result.partial = true
        return
      }
      const children = await opendir(filename)
      for await (const child of children) {
        if (filename === directory && child.name === 'node_modules') continue
        if (exhausted()) { result.partial = true; break }
        await walk(path.join(filename, child.name), depth + 1, modules)
      }
    } catch { result.partial = true }
  }

  // Measure the actionable root folder first, so a large source tree does not
  // consume the scan budget before dependencies can be measured.
  const modulesPath = path.join(directory, 'node_modules')
  reportEntries()
  try {
    const modulesInfo = await lstat(modulesPath)
    result.hasNodeModules = true
    await walk(modulesPath, 1, true, modulesInfo)
  } catch (error) {
    if (!missing(error)) result.partial = true
  }
  phase = 'Measuring project files and build output'
  reportEntries()
  await walk(directory, 0, false, rootInfo)
  phase = 'Preparing the storage report'
  reportEntries()
  result.measuredAt = new Date().toISOString()
  return result
}

/** Remove only this project's real, root-level node_modules directory. */
export async function removeProjectNodeModules(directory: string, expected?: { dev: string; ino: string }): Promise<ProjectStorage> {
  const projectInfo = await projectDirectory(directory)
  const modulesPath = path.join(directory, 'node_modules')
  let modulesInfo: Stats
  try { modulesInfo = await lstat(modulesPath) }
  catch (error) {
    if (missing(error) && !expected) return measureProjectStorage(directory)
    throw new HelperError('The node_modules folder cannot be read. Check its permissions.', 403)
  }
  if (modulesInfo.isSymbolicLink() || !modulesInfo.isDirectory()) {
    throw new HelperError('Deletion is only available for a real node_modules directory. Linked folders and files are never removed.', 409)
  }
  try {
    const currentProject = await projectDirectory(directory)
    const currentModules = await lstat(modulesPath)
    if ((expected && (String(currentModules.dev) !== expected.dev || String(currentModules.ino) !== expected.ino))
      || !sameEntry(projectInfo, currentProject) || !sameEntry(modulesInfo, currentModules)
      || currentModules.isSymbolicLink() || !currentModules.isDirectory()
      || await realpath(modulesPath) !== modulesPath) {
      throw new HelperError('The project or node_modules folder changed. Sync again before deleting dependencies.', 409)
    }
    // Node's recursive removal unlinks nested symlinks rather than following
    // them. It does not execute package lifecycle scripts. As with other local
    // filesystem actions, callers must not concurrently replace project paths.
    await rm(modulesPath, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 })
  } catch (error) {
    if (error instanceof HelperError) throw error
    throw new HelperError('Could not completely remove node_modules. Stop processes using it, check permissions, and refresh disk usage before trying again.', 409)
  }
  return measureProjectStorage(directory)
}
