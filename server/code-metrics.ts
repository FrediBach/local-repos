import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { scanCodeMetrics } from '../src/lib/code-metrics'

export async function readCodeMetrics(directory: string, root: string) {
  async function canonical(relative: string) {
    const candidate = path.join(root, relative)
    if (await realpath(candidate) !== candidate) throw new Error('Code path changed')
    return candidate
  }
  return scanCodeMetrics({
    async *entries(relative) {
      const folder = await opendir(await canonical(relative))
      for await (const entry of folder) yield {
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }
    },
    async read(relative, maxBytes) {
      try {
        if ((await lstat(path.join(root, relative))).isSymbolicLink()) return undefined
        const candidate = await canonical(relative)
        const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const info = await handle.stat()
          if (!info.isFile() || info.size > maxBytes || await canonical(relative) !== candidate) return undefined
          const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          if (bytesRead > maxBytes || bytesRead !== info.size || (await handle.stat()).size !== info.size) return undefined
          return buffer.subarray(0, bytesRead).toString('utf8')
        } finally {
          await handle.close()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        return undefined
      }
    },
  }, path.relative(root, directory).split(path.sep).join('/'))
}
