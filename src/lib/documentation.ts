import type { ProjectDocumentation, ProjectDocument } from '../types'

export const documentationFolders = ['doc', 'docs', 'documentation'] as const
const ignoredFolders = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', 'venv', '__pycache__'])
const MAX_FILES = 200
const MAX_FOLDERS = 100
const MAX_ENTRIES = 2_000
const MAX_DEPTH = 8
const MAX_FILE_BYTES = 128 * 1024
const MAX_TOTAL_BYTES = 512 * 1024

export interface DocumentationSource {
  entries: (path: string) => AsyncIterable<{ name: string; kind: 'file' | 'directory' | 'other' }>
  /** Return undefined for unreadable, unsafe, or oversized files. Never truncate. */
  read: (path: string, maxBytes: number) => Promise<string | undefined>
}

/** Shared, bounded discovery for browser handles and the local helper. */
export async function scanDocumentation(roots: string[], source: DocumentationSource): Promise<ProjectDocumentation> {
  const files: ProjectDocument[] = []
  const warnings = new Set<string>()
  let folders = 0
  let entries = 0
  let bytes = 0
  const limit = () => warnings.add('Documentation discovery was limited to 200 files, 100 folders, 2,000 entries, and 8 folder levels. Some files may be missing.')

  async function visit(directory: string, depth: number): Promise<void> {
    if (folders >= MAX_FOLDERS || entries >= MAX_ENTRIES || files.length >= MAX_FILES || depth > MAX_DEPTH) {
      limit()
      return
    }
    folders += 1
    try {
      for await (const entry of source.entries(directory)) {
        if (entries >= MAX_ENTRIES || files.length >= MAX_FILES) { limit(); break }
        entries += 1
        if (entry.name.startsWith('.') || entry.name.includes('/') || entry.name.includes('\\')) continue
        const path = `${directory}/${entry.name}`
        if (entry.kind === 'directory' && !ignoredFolders.has(entry.name)) await visit(path, depth + 1)
        if (entry.kind !== 'file' || !/\.(md|mdx|markdown)$/i.test(entry.name)) continue
        const remaining = MAX_TOTAL_BYTES - bytes
        const content = remaining > 0 ? await source.read(path, Math.min(MAX_FILE_BYTES, remaining)).catch(() => undefined) : undefined
        if (content === undefined) {
          files.push({ path, unavailable: 'This file could not be read within the documentation size limits. It may be too large, inaccessible, or changed since discovery.' })
          warnings.add('Some documentation could not be cached. Reads are limited to 128 KiB per file and 512 KiB per project.')
        } else {
          bytes += new TextEncoder().encode(content).byteLength
          files.push({ path, content })
        }
      }
    } catch {
      warnings.add(`${directory}: documentation folder could not be read.`)
    }
  }

  for (const root of roots.sort()) await visit(root, 1)
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), warnings: [...warnings] }
}

export interface DocumentationTree {
  name: string
  path: string
  file?: ProjectDocument
  children: DocumentationTree[]
}

export function documentationTree(files: ProjectDocument[]): DocumentationTree[] {
  const root: DocumentationTree = { name: '', path: '', children: [] }
  for (const file of files) {
    let parent = root
    const parts = file.path.split('/')
    parts.forEach((name, index) => {
      let node = parent.children.find(child => child.name === name)
      if (!node) {
        node = { name, path: parts.slice(0, index + 1).join('/'), children: [] }
        parent.children.push(node)
      }
      if (index === parts.length - 1) node.file = file
      parent = node
    })
  }
  function sort(nodes: DocumentationTree[]): DocumentationTree[] {
    nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
    nodes.forEach(node => sort(node.children))
    return nodes
  }
  return sort(root.children)
}
