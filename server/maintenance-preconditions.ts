import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { RegisteredProject } from './scanner'
import { McpFailure } from './mcp/errors'

// Include missing files too: creating a new lock or configuration invalidates a plan.
const names = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', 'pnpmfile.cjs', '.pnp.cjs', '.trivyignore', '.trivignore']
const stale = () => new McpFailure('PRECONDITION_FAILED', 'Package files or directory identity changed. Prepare a new maintenance plan.')

export async function directoryIdentity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true }).catch(() => { throw stale() })
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw stale()
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`
}

/** Bounded content reads with no final symlink following; never evaluate configuration. */
export async function maintenancePreconditions(entries: RegisteredProject[], cleanupDirectory?: string) {
  const hash = createHash('sha256')
  const files: { projectId: string; name: string }[] = []
  let total = 0
  const directories = new Map<string, string>()
  for (const entry of [...entries].sort((a, b) => a.project.id.localeCompare(b.project.id))) {
    directories.set(entry.directory, entry.project.id)
    if (entry.workspaceDirectory && !directories.has(entry.workspaceDirectory)) directories.set(entry.workspaceDirectory, entry.project.monorepo?.id ?? entry.project.id)
    hash.update(JSON.stringify([entry.project.id, entry.directory, entry.workspaceDirectory, entry.project.packageManager, entry.project.monorepo]))
  }
  for (const [directory, projectId] of [...directories].sort(([a], [b]) => a.localeCompare(b))) {
    const identity = await directoryIdentity(directory)
    hash.update(JSON.stringify([directory, identity]))
    for (const name of names) {
      files.push({ projectId, name })
      hash.update(JSON.stringify([directory, name]))
      let file
      try { file = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { hash.update(JSON.stringify(['missing'])); continue }
        throw stale()
      }
      try {
        const before = await file.stat({ bigint: true })
        if (!before.isFile() || before.size > 8n * 1024n * 1024n) throw new McpFailure('RESOURCE_LIMIT', 'Maintenance requires regular package inputs of at most 8 MiB each.')
        const bytes = Buffer.alloc(Number(before.size) + 1)
        let offset = 0
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
          if (!bytesRead) break
          offset += bytesRead
        }
        total += offset
        if (total > 32 * 1024 * 1024) throw new McpFailure('RESOURCE_LIMIT', 'Package inputs exceed the 32 MiB maintenance limit.')
        const after = await file.stat({ bigint: true })
        const current = await lstat(path.join(directory, name), { bigint: true })
        if (BigInt(offset) !== before.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || current.ino !== before.ino || current.dev !== before.dev || !current.isFile()) throw stale()
        hash.update(JSON.stringify(['file', createHash('sha256').update(bytes.subarray(0, offset)).digest('hex')]))
      } finally { await file.close() }
    }
    if (await directoryIdentity(directory) !== identity) throw stale()
  }
  const cleanupIdentity = cleanupDirectory ? await directoryIdentity(path.join(cleanupDirectory, 'node_modules')) : undefined
  hash.update(cleanupIdentity ?? '')
  return { digest: hash.digest('hex'), files, cleanupIdentity }
}
