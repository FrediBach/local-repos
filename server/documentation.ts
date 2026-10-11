import { constants } from 'node:fs'
import { open, opendir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { scanDocumentation } from '../src/lib/documentation'

export async function readProjectDocumentation(directory: string, roots: string[]) {
  // Every component must retain its canonical identity; directory/file symlinks
  // are never followed, including replacements made while a scan is running.
  async function canonical(relative: string): Promise<string> {
    const candidate = path.join(directory, relative)
    if (await realpath(candidate) !== candidate) throw new Error('Documentation path changed')
    return candidate
  }
  return scanDocumentation(roots, {
    async *entries(relative) {
      const folder = await opendir(await canonical(relative))
      for await (const entry of folder) yield {
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }
    },
    async read(relative, maxBytes) {
      const candidate = await canonical(relative)
      const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > maxBytes || await canonical(relative) !== candidate) return undefined
        const buffer = Buffer.alloc(maxBytes + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return bytesRead > maxBytes ? undefined : buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
    },
  })
}
