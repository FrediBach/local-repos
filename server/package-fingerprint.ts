import { createHash } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const packageFiles = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', '.npmrc', '.yarnrc.yml']

/** Stat only a fixed set of package inputs, never dependencies or symlink targets. */
export async function packageFingerprint(directory: string): Promise<string> {
  try {
    if (await realpath(directory) !== directory || !(await stat(directory)).isDirectory()) return 'missing'
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'missing'
    throw error
  }
  const inputs = await Promise.all(packageFiles.map(async name => {
    try {
      const info = await lstat(path.join(directory, name), { bigint: true })
      return [name, info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : 'other', String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs)]
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return [name, 'missing']
      throw error
    }
  }))
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}

export function repositoryFingerprint(own: string, workspace?: string): string {
  return workspace ? `${own}:${workspace}` : own
}
