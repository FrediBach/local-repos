import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { selectDevScript } from '../src/lib/dev-script'
import { HelperError, type RegisteredProject } from './scanner'

interface ServerScript {
  tokens: string[]
  assignments: Record<string, string>
  hostFlags: string[]
  portFlags: string[]
  portEnvironment: string[]
  hostEnvironment: string[]
  strictPort?: boolean
  environmentOnly?: boolean
}

/** Only inspect a simple command; never interpret or execute shell expressions. */
function simpleCommand(script: string): { tokens: string[]; assignments: Record<string, string> } | undefined {
  if (/[|&;<>()`#\r\n]/.test(script)) return undefined
  const tokens: string[] = []
  let token = ''
  let quote = ''
  let escaped = false
  for (const character of script.trim()) {
    if (escaped) { token += character; escaped = false; continue }
    if (character === '\\' && quote !== "'") { escaped = true; continue }
    if (quote) {
      if (character === quote) quote = ''
      else token += character
    } else if (character === '"' || character === "'") quote = character
    else if (/\s/.test(character)) {
      if (token) tokens.push(token)
      token = ''
    } else token += character
  }
  if (quote || escaped) return undefined
  if (token) tokens.push(token)
  const assignments: Record<string, string> = {}
  while (tokens.length) {
    const assignment = /^([A-Za-z_][A-Za-z_\d]*)=(.*)$/.exec(tokens[0])
    if (assignment) {
      assignments[assignment[1]] = assignment[2]
      tokens.shift()
    } else if (['cross-env', 'env'].includes(path.basename(tokens[0]))) tokens.shift()
    else break
  }
  // npx wrappers are common in package scripts. Flags to npx itself are left
  // alone because their argument forwarding rules vary by version.
  if (tokens[0] === 'npx' && tokens[1] && !tokens[1].startsWith('-')) tokens.shift()
  if (!tokens.length || tokens.includes('--')) return undefined
  return { tokens, assignments }
}

function serverScript(script: string): ServerScript | undefined {
  const parsed = simpleCommand(script)
  if (!parsed) return undefined
  const [executable, subcommand] = parsed.tokens
  const binary = path.basename(executable)
  const common = { ...parsed, hostFlags: ['--host'], portFlags: ['--port'], portEnvironment: [] as string[], hostEnvironment: [] as string[] }
  switch (binary) {
    case 'vite':
      if (['build', 'optimize'].includes(subcommand)) return undefined
      return { ...common, strictPort: true }
    case 'next':
      if (subcommand && !subcommand.startsWith('-') && !['dev', 'start'].includes(subcommand)) return undefined
      return { ...common, hostFlags: ['--hostname', '-H'], portFlags: ['--port', '-p'], portEnvironment: ['PORT'] }
    case 'astro':
      return ['dev', 'preview'].includes(subcommand) ? common : undefined
    case 'nuxt':
    case 'nuxi':
      if (subcommand && !subcommand.startsWith('-') && subcommand !== 'dev') return undefined
      return { ...common, hostFlags: ['--host', '--hostname', '-h'], portFlags: ['--port', '-p'], portEnvironment: ['NUXT_PORT', 'PORT'], hostEnvironment: ['NUXT_HOST', 'HOST'] }
    case 'ng':
    case 'vue-cli-service':
      return subcommand === 'serve' ? common : undefined
    case 'webpack':
      return subcommand === 'serve' ? common : undefined
    case 'webpack-dev-server':
      return common
    case 'parcel':
      if (['build', 'watch', 'help'].includes(subcommand)) return undefined
      return { ...common, portFlags: ['--port', '-p'], portEnvironment: ['PORT'] }
    case 'react-scripts':
      return subcommand === 'start' ? { ...common, portEnvironment: ['PORT'], hostEnvironment: ['HOST'], environmentOnly: true } : undefined
    default:
      return undefined
  }
}

function option(tokens: string[], flags: string[]): { present: boolean; value?: string } {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    for (const flag of flags) {
      if (token === flag) return { present: true, value: tokens[index + 1]?.startsWith('-') ? undefined : tokens[index + 1] }
      if (token.startsWith(`${flag}=`)) return { present: true, value: token.slice(flag.length + 1) }
      if (flag.length === 2 && token.startsWith(flag) && token.length > 2) return { present: true, value: token.slice(flag.length) }
    }
  }
  return { present: false }
}

function assigned(script: ServerScript, names: string[]): string | undefined {
  return names.map((name) => script.assignments[name]).find((value) => value !== undefined)
}

export function devCommand(entry: RegisteredProject, port: number, platform = process.platform): { command: string; args: string[]; env?: Record<string, string> } {
  if (platform === 'win32') throw new HelperError('Starting local dev servers and capturing local previews on Windows are not supported by this POC yet. Choose Project URL to capture a deployed website; folder scanning still works.', 501)
  const selected = selectDevScript(entry.project)
  if (!selected) throw new HelperError('This project does not define a dev script, start script, or serve script in package.json.')
  const script = serverScript(selected.command)
  const flags: string[] = []
  if (script && !script.environmentOnly) {
    if (!option(script.tokens, script.hostFlags).present && assigned(script, script.hostEnvironment) === undefined) flags.push(script.hostFlags[0], '127.0.0.1')
    if (!option(script.tokens, script.portFlags).present && assigned(script, script.portEnvironment) === undefined) flags.push('--port', String(port))
    if (script.strictPort && !option(script.tokens, ['--strictPort', '--strict-port']).present) flags.push('--strictPort')
  }
  const command = entry.project.packageManager
  const args = command === 'npm' ? ['run', selected.name, ...(flags.length ? ['--', ...flags] : [])] : ['run', selected.name, ...flags]
  return { command, args }
}

function loopbackUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = '127.0.0.1'
    if (url.hostname !== 'localhost' && url.hostname !== '[::1]' && !/^127(?:\.\d{1,3}){3}$/.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Read the accumulated process output, so URLs split between chunks still work. */
export function discoverServerUrls(logs: string): string[] {
  const urls = new Set<string>()
  const plain = stripVTControlCharacters(logs)
  for (const match of plain.matchAll(/https?:\/\/[^\s<>"'\u0000-\u0020\u007f]+/gi)) {
    const value = match[0].replace(/[),.;!?]+$/, '')
    const url = loopbackUrl(value)
    if (url) urls.add(url)
  }
  return [...urls]
}

/** Use declared addresses only; no probing arbitrary framework default ports. */
export function configuredServerUrls(command: string, fallbackPort: number): string[] {
  const script = serverScript(command)
  const parsed = script ?? simpleCommand(command)
  if (!parsed) return []
  const portOption = script ? option(script.tokens, script.portFlags) : { present: false }
  const portValue = portOption.present ? portOption.value : script ? assigned(script, script.portEnvironment) ?? String(fallbackPort) : parsed.assignments.PORT
  if (!portValue || !/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) return []
  const hostOption = script ? option(script.tokens, script.hostFlags) : { present: false }
  const host = hostOption.present ? hostOption.value ?? '127.0.0.1' : script ? assigned(script, script.hostEnvironment) ?? '127.0.0.1' : parsed.assignments.HOST ?? '127.0.0.1'
  const httpsOption = option(parsed.tokens, ['--https', '--experimental-https', '--ssl'])
  const secure = (httpsOption.present && httpsOption.value !== 'false') || parsed.assignments.HTTPS === 'true'
  const base = option(parsed.tokens, ['--base', '--serve-path']).value
  const pathname = base?.startsWith('/') && !base.startsWith('//') ? base : '/'
  const hostname = host === '::' || host === '::1' ? `[${host}]` : host
  const url = loopbackUrl(`${secure ? 'https' : 'http'}://${hostname}:${portValue}${pathname}`)
  return url ? [url] : []
}
