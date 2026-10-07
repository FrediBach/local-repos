import type { RepoProject } from '../types'

export interface PackageMetadata {
  name?: string
  version?: string
  author?: string
  license?: string
  description?: string
  homepage?: string
  previewUrl?: string
  stack: string[]
  scripts: Record<string, string>
  packageManager: RepoProject['packageManager']
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

/** App previews need an absolute web URL, never a repository page or credentials. */
export function normalizePreviewUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw || raw.length > 4096 || !/^https?:\/\/[^/\\?#\s]/i.test(raw) || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return undefined
  try {
    const url = new URL(raw)
    if (!url.hostname || url.username || url.password) return undefined
    // These hosts serve repository interfaces. GitHub Pages and custom app
    // domains are separate hosts and remain valid preview targets.
    if (/^(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)$/.test(url.hostname) || url.hostname === 'api.github.com') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

const technologies: [string, string[]][] = [
  ['React', ['react', 'react-dom']],
  ['Next.js', ['next']],
  ['Vue', ['vue']],
  ['Nuxt', ['nuxt']],
  ['Svelte', ['svelte', '@sveltejs/kit']],
  ['Astro', ['astro']],
  ['Angular', ['@angular/core']],
  ['Solid', ['solid-js']],
  ['TypeScript', ['typescript']],
  ['Vite', ['vite']],
  ['Tailwind CSS', ['tailwindcss', '@tailwindcss/vite']],
  ['shadcn/ui', ['shadcn', 'shadcn-ui']],
  ['Electron', ['electron']],
  ['Tauri', ['@tauri-apps/api', '@tauri-apps/cli']],
  ['Express', ['express']],
  ['Fastify', ['fastify']],
  ['Hono', ['hono']],
  ['Prisma', ['prisma', '@prisma/client']],
  ['Drizzle', ['drizzle-orm']],
  ['Supabase', ['@supabase/supabase-js']],
  ['Vitest', ['vitest']],
  ['Playwright', ['playwright', '@playwright/test']],
]

/** Parse only displayable package fields; no package code is evaluated. */
export function parsePackageJson(source: string): PackageMetadata {
  const parsed: unknown = JSON.parse(source)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json must contain an object.')
  }
  const pkg = record(parsed)
  const dependencies = {
    ...record(pkg.dependencies),
    ...record(pkg.devDependencies),
    ...record(pkg.peerDependencies),
  }
  const scripts = Object.fromEntries(
    Object.entries(record(pkg.scripts)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  const declaredManager = text(pkg.packageManager)?.split('@')[0]
  const packageManager = declaredManager === 'pnpm' || declaredManager === 'yarn' || declaredManager === 'bun'
    ? declaredManager : 'npm'
  return {
    name: text(pkg.name),
    version: text(pkg.version),
    author: text(pkg.author) ?? text(record(pkg.author).name),
    license: text(pkg.license) ?? text(record(pkg.license).type),
    description: text(pkg.description),
    homepage: normalizePreviewUrl(pkg.homepage),
    previewUrl: normalizePreviewUrl(record(pkg.localRepos).previewUrl),
    stack: technologies.filter(([, packages]) => packages.some((name) => name in dependencies)).map(([name]) => name),
    scripts,
    packageManager,
  }
}

function plainMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pick the first prose paragraph, skipping titles, badges, code and setup lists. */
export function extractReadmeIntro(markdown: string, maxLength = 360): string {
  const lines = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  let fence: string | undefined
  const paragraph: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const fenceMatch = line.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence && paragraph.length) break
      if (!fence) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = undefined
      continue
    }
    if (fence) continue
    if (!line) {
      if (paragraph.length) break
      continue
    }
    const isTitle = /^(#{1,6}\s|[=-]{3,}\s*$)/.test(line)
      || /^[=-]{3,}\s*$/.test(lines[index + 1]?.trim() ?? '')
    const isDecoration = /^(?:\[!\[|!\[|<\/?(?:p|div|img|picture|source|a|svg|br)\b|\[[^\]]+\]:)/i.test(line)
    const isListOrTable = /^(?:[-*+]\s|\d+[.)]\s|>|\|)/.test(line)
    if (isTitle || isDecoration || isListOrTable) {
      if (paragraph.length) break
      continue
    }
    const clean = plainMarkdown(line)
    if (clean) paragraph.push(clean)
  }
  const intro = paragraph.join(' ')
  if (intro.length <= maxLength) return intro
  const truncated = intro.slice(0, Math.max(0, maxLength - 1))
  const boundary = truncated.lastIndexOf(' ')
  return `${boundary > maxLength * 0.7 ? truncated.slice(0, boundary) : truncated}…`
}

export function parseGitHead(source: string): { branch?: string; commit?: string } {
  const head = source.trim()
  const branch = head.match(/^ref:\s+refs\/heads\/(.+)$/)?.[1]
  if (branch) return { branch }
  if (/^[a-f0-9]{40,64}$/i.test(head)) return { branch: 'detached', commit: head }
  return {}
}

/** Only HTTP(S) repository URLs are returned, without embedded credentials. */
export function normalizeGitOrigin(value: string): string | undefined {
  const raw = value.trim()
  const ssh = raw.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/)
  const candidate = ssh && !raw.includes('://')
    ? `https://${ssh[1]}/${ssh[2]}`
    : raw.replace(/^(?:git|ssh):\/\/(?:[^@/]+@)?/i, 'https://')
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.username = ''
    url.password = ''
    url.pathname = url.pathname.replace(/\.git\/?$/, '')
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function parseGitConfig(source: string): string | undefined {
  let isOrigin = false
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('[')) isOrigin = /^\[remote\s+"origin"\]\s*$/i.test(line)
    if (isOrigin) {
      const remote = line.match(/^url\s*=\s*(.+)$/i)?.[1]
      if (remote) return normalizeGitOrigin(remote.replace(/^"(.*)"$/, '$1'))
    }
  }
  return undefined
}

export function parseGitLog(source: string, expectedCommit?: string): { commit?: string; message?: string; committedAt?: string } {
  // A reflog also records checkout/reset events; those are not commit messages.
  const latest = source.trim().split(/\r?\n/).reverse().find((line) => {
    const [header, action] = line.split('\t')
    return /^commit(?: \([^)]*\))?:/.test(action ?? '') && (!expectedCommit || header.split(/\s+/)[1] === expectedCommit)
  })
  if (!latest) return {}
  const match = latest.match(/^[a-f0-9]+\s+([a-f0-9]+)\s+.*?\s+(\d+)\s+[+-]\d{4}\t(.*)$/i)
  if (!match) return {}
  const date = new Date(Number(match[2]) * 1000)
  return {
    commit: match[1],
    message: match[3].replace(/^commit(?: \([^)]*\))?:\s*/, ''),
    committedAt: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
  }
}
