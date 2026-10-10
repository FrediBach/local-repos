import type { LighthouseReport, RepoProject } from '../types'
import { selectDevScript, simpleCommand } from './dev-script'
import { normalizePreviewUrl } from './metadata'

const valueOptions = new Set(['--port', '-p', '--config', '-c', '--mode', '-m', '--hostname', '-H', '--base', '--root', '--root-dir', '--dotenv', '--cwd', '--dir', '--logLevel', '--configLoader', '--env', '--target', '--dist-dir', '--outDir', '--cache-dir', '--serve-path', '--configuration', '--project'])
const optionalValueOptions = new Set(['--host', '--open', '--https', '--ssl', '--profile', '--debug', '-d', '--inspect'])
const booleanOptions = new Set(['--strictPort', '--strict-port', '--force', '--clearScreen', '--cors', '--experimentalBundle', '--no-open', '--no-hmr', '--no-cache', '--no-autoinstall', '--offline', '--turbo', '--turbopack', '--webpack'])

/** Read the first positional argument, respecting option values before it. */
function firstArgument(tokens: string[]): string | null | undefined {
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.startsWith('-')) return token
    const option = token.split('=')[0]
    if (valueOptions.has(option)) {
      if (token.includes('=')) continue
      if (!tokens[index + 1] || tokens[index + 1].startsWith('-')) return null
      index += 1
    } else if (optionalValueOptions.has(option)) {
      if (!token.includes('=') && tokens[index + 1] && !tokens[index + 1].startsWith('-')) index += 1
    } else if (booleanOptions.has(option)) continue
    else if (token[1] !== '-' && token.length > 2 && valueOptions.has(token.slice(0, 2))) continue
    else return null
  }
}

/** Conservative detection: dependencies alone also describe libraries and APIs. */
export function isFrontendDevScript(command: string): boolean {
  // Do not guess what a wrapper, compound shell command, or interpolated script
  // starts. Such projects can declare their frontend through localRepos.previewUrl.
  if (command.includes('$')) return false
  const parsed = simpleCommand(command)
  if (!parsed) return false
  const { tokens } = parsed
  if (tokens.some(token => ['--help', '-h', '--version', '-v', '--watch', '-w'].includes(token.split('=')[0]))) return false
  const binary = tokens[0]?.split('/').pop()
  const task = firstArgument(tokens)
  if (task === null) return false
  switch (binary) {
    // Vite's default command takes a root directory, so `vite web` is a server.
    case 'vite': return !task || !['build', 'optimize', 'help'].includes(task)
    case 'next': return !task || ['dev', 'start'].includes(task)
    case 'astro': return !!task && ['dev', 'preview'].includes(task)
    case 'nuxt':
    case 'nuxi': return !task || task === 'dev'
    case 'ng':
    case 'vue-cli-service':
    case 'webpack': return task === 'serve'
    case 'webpack-dev-server': return true
    case 'parcel': return !task || task === 'serve' || /\.html?$/.test(task)
    case 'react-scripts': return task === 'start'
    default: return false
  }
}

/** Explicit frontend URLs opt custom launchers in; a package homepage does not. */
export function isLighthouseProject(project: Pick<RepoProject, 'scripts' | 'previewUrl'>): boolean {
  if (normalizePreviewUrl(project.previewUrl)) return true
  const selected = selectDevScript(project)
  return !!selected && isFrontendDevScript(selected.command)
}

export function lighthouseScoreLevel(score: number | null): 'good' | 'warning' | 'poor' | 'unknown' {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100) return 'unknown'
  return score >= 90 ? 'good' : score >= 50 ? 'warning' : 'poor'
}

/** Lighthouse has no overall score. The compact badge reports performance. */
export function lighthousePerformanceScore(report: LighthouseReport): number | null {
  const score = report.categories.find(category => category.id === 'performance')?.score
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null
}
