import ignore, { type Ignore } from 'ignore'
import { codeDistribution } from './code-distribution'
import type { CodeFileStatistics, CodeLargeFile, CodeMetrics } from '../types'

const languages: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  py: 'Python', pyi: 'Python', rs: 'Rust', go: 'Go', php: 'PHP', rb: 'Ruby',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', dart: 'Dart',
  c: 'C', h: 'C/C++ headers', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++',
  cs: 'C#', fs: 'F#', fsx: 'F#', scala: 'Scala', clj: 'Clojure', cljs: 'Clojure',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', lua: 'Lua', r: 'R',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell',
  sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protocol Buffers',
  json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  tf: 'Terraform', hcl: 'HCL', cmake: 'CMake', gradle: 'Gradle',
}
const filenames: Record<string, string> = { Dockerfile: 'Dockerfile', Containerfile: 'Dockerfile', Makefile: 'Makefile', GNUmakefile: 'Makefile', Gemfile: 'Ruby', Rakefile: 'Ruby', 'CMakeLists.txt': 'CMake' }
const excludedFolders = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', 'venv', '.venv', '__pycache__', '.next', '.nuxt', '.cache'])
const lockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'composer.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock'])
const MAX_ENTRIES = 20_000
const MAX_FOLDERS = 2_000
const MAX_BYTES = 32 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_IGNORE_BYTES = 64 * 1024
const MAX_DEPTH = 20

export interface CodeSource {
  entries: (path: string) => AsyncIterable<{ name: string; kind: 'file' | 'directory' | 'other' }>
  /** null means absent; undefined means unsafe, unreadable or oversized. Never truncate. */
  read: (path: string, maxBytes: number) => Promise<string | null | undefined>
}
type Rules = { directory: string; matcher: Ignore }[]
const join = (directory: string, name: string) => directory ? `${directory}/${name}` : name
const largestFirst = (a: CodeLargeFile, b: CodeLargeFile) => b.lines - a.lines || a.path.localeCompare(b.path)

function fileStatistics(lineCounts: number[]): CodeFileStatistics {
  if (!lineCounts.length) return { average: null, min: null, max: null, median: null }
  const sorted = [...lineCounts].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    average: sorted.reduce((sum, count) => sum + count, 0) / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
  }
}

/** Read-only counts, shared by both connection modes. Paths are relative to the granted root. */
export async function scanCodeMetrics(source: CodeSource, projectPath = ''): Promise<CodeMetrics> {
  const counts = new Map<string, { name: string; lines: number; files: number; lineCounts: number[]; largestFiles: CodeLargeFile[] }>()
  const warnings = new Set<string>()
  let entries = 0
  let folders = 0
  let bytes = 0
  const deadline = Date.now() + 10_000
  const limited = () => entries >= MAX_ENTRIES || folders >= MAX_FOLDERS || bytes >= MAX_BYTES || Date.now() >= deadline
  const limit = () => warnings.add('Scan limit reached (20,000 entries, 2,000 folders, 20 levels, 32 MiB, or 10 seconds). Counts are partial.')

  async function list(directory: string) {
    const result: { name: string; kind: 'file' | 'directory' | 'other' }[] = []
    if (limited()) { limit(); return result }
    folders += 1
    for await (const entry of source.entries(directory)) {
      if (entries >= MAX_ENTRIES || Date.now() >= deadline) { limit(); break }
      entries += 1
      if (!entry.name || entry.name === '.' || entry.name === '..' || /[/\\]/.test(entry.name)) continue
      result.push(entry)
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function rulesFor(directory: string, inherited: Rules): Promise<Rules> {
    const text = await source.read(join(directory, '.gitignore'), Math.min(MAX_IGNORE_BYTES, MAX_BYTES - bytes))
    if (text === undefined) throw new Error('Ignore rules unavailable')
    if (!text) return inherited
    bytes += new TextEncoder().encode(text).byteLength
    return [...inherited, { directory, matcher: ignore({ ignorecase: false }).add(text) }]
  }

  function ignored(relative: string, rules: Rules) {
    let excluded = false
    for (const rule of rules) {
      const local = rule.directory ? relative.slice(rule.directory.length + 1) : relative
      const result = rule.matcher.test(local)
      if (result.ignored) excluded = true
      if (result.unignored) excluded = false
    }
    return excluded
  }

  async function visit(directory: string, inherited: Rules, depth: number): Promise<void> {
    if (limited() || depth > MAX_DEPTH) { limit(); return }
    try {
      const children = await list(directory)
      const ownGit = children.some(entry => entry.name === '.git')
      if (ownGit && depth > 0) return // Separate checkouts belong to their own project.
      if (!ownGit && directory && ignored(`${directory}/`, inherited)) return
      const rules = await rulesFor(directory, ownGit ? [] : inherited)
      for (const entry of children) {
        if (limited()) { limit(); break }
        const relative = join(directory, entry.name)
        if (entry.kind === 'other' || excludedFolders.has(entry.name) || lockfiles.has(entry.name)) continue
        if (ignored(relative + (entry.kind === 'directory' ? '/' : ''), rules)) continue
        if (entry.kind === 'directory') { await visit(relative, rules, depth + 1); continue }
        const extension = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : ''
        const language = Object.hasOwn(filenames, entry.name) ? filenames[entry.name]
          : Object.hasOwn(languages, extension) ? languages[extension] : undefined
        if (!language) continue
        const text = await source.read(relative, Math.min(MAX_FILE_BYTES, MAX_BYTES - bytes)).catch(() => undefined)
        if (text == null) { warnings.add('Some source files were unreadable or exceeded the 1 MiB file / 32 MiB project limits. Counts are partial.'); continue }
        bytes += new TextEncoder().encode(text).byteLength
        if (text.includes('\0')) continue
        const lines = text.split(/\r\n|\n|\r/).filter(line => line.trim().length > 0).length
        const row = counts.get(language) ?? { name: language, lines: 0, files: 0, lineCounts: [], largestFiles: [] }
        row.lines += lines
        row.files += 1
        row.lineCounts.push(lines)
        if (lines >= 500) {
          row.largestFiles.push({ path: projectPath ? relative.slice(projectPath.length + 1) : relative, language, lines })
          row.largestFiles.sort(largestFirst)
          if (row.largestFiles.length > 10) row.largestFiles.pop()
        }
        counts.set(language, row)
      }
    } catch {
      warnings.add('Some folders or .gitignore files could not be read safely. Those folders were skipped; counts are partial.')
    }
  }

  // Workspace members inherit ignore files up to the selected root, stopping at repository boundaries.
  let rules: Rules = []
  try {
    const ancestors: { directory: string; ownGit: boolean }[] = []
    let ancestor = ''
    for (const segment of [...projectPath.split('/').filter(Boolean), '']) {
      ancestors.push({ directory: ancestor, ownGit: (await list(ancestor)).some(entry => entry.name === '.git') })
      if (segment) ancestor = join(ancestor, segment)
    }
    let start = 0
    ancestors.forEach((entry, index) => { if (entry.ownGit) start = index })
    let excluded = false
    for (const entry of ancestors.slice(start, -1)) {
      if (entry.directory && ignored(`${entry.directory}/`, rules)) { excluded = true; break }
      rules = await rulesFor(entry.directory, rules)
    }
    if (!excluded) await visit(projectPath, rules, 0)
  } catch {
    warnings.add('Parent .gitignore rules could not be read safely. Counts are unavailable.')
  }
  const rows = [...counts.values()].map(({ lineCounts, ...row }) => ({ ...row, fileStatistics: fileStatistics(lineCounts), distribution: codeDistribution(lineCounts) })).sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name))
  const allLineCounts = [...counts.values()].flatMap(row => row.lineCounts)
  const largestFiles = rows.flatMap(row => row.largestFiles).sort(largestFirst).slice(0, 10)
  return { scannedAt: new Date().toISOString(), totalLines: rows.reduce((sum, row) => sum + row.lines, 0), totalFiles: rows.reduce((sum, row) => sum + row.files, 0), fileStatistics: fileStatistics(allLineCounts), distribution: codeDistribution(allLineCounts), largestFiles, languages: rows, partial: warnings.size > 0, warnings: [...warnings] }
}
