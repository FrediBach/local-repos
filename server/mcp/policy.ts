import { createHash, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { isWithin } from '../scanner'
import { McpFailure } from './errors'

const capability = z.enum(['read', 'discovery', 'git'])
const configSchema = z.strictObject({
  enabled: z.literal(true),
  roots: z.array(z.string().min(1).max(4096)).min(1).max(32),
  clients: z.array(z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    token: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/),
    roots: z.array(z.string().min(1).max(4096)).min(1).max(32),
    capabilities: z.array(capability).default(['read', 'discovery', 'git']),
    disclosePaths: z.boolean().default(false),
    discloseContent: z.boolean().default(false),
  })).min(1).max(32),
})
export interface AllowedRoot { id: string; directory: string; name: string }
export interface Principal {
  id: string
  roots: AllowedRoot[]
  capabilities: z.infer<typeof capability>[]
  disclosePaths: boolean
  discloseContent: boolean
}
export interface McpPolicy { roots: AllowedRoot[]; clients: { principal: Principal; digest: Buffer }[] }
export const rootId = (directory: string) => `root_${createHash('sha256').update(directory).digest('hex').slice(0, 20)}`

/** Read a regular, owner-only local file without following a final symlink. */
export async function readProtectedJson(filename: string): Promise<unknown> {
  if (!path.isAbsolute(filename)) throw new Error('MCP configuration requires an absolute path.')
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 64 * 1024 || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) {
      throw new Error('MCP configuration must be an owner-only regular file (chmod 600), at most 64 KiB.')
    }
    const bytes = Buffer.alloc(64 * 1024 + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 64 * 1024) throw new Error('MCP configuration is too large.')
    try { return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')) }
    catch { throw new Error('Invalid JSON in protected MCP configuration.') }
  } finally { await file.close() }
}

export async function loadPolicy(filename: string | undefined): Promise<McpPolicy | undefined> {
  if (!filename) return undefined
  const parsed = configSchema.safeParse(await readProtectedJson(filename))
  if (!parsed.success) throw new Error('Invalid MCP configuration. Check roots, client IDs, tokens, and capabilities.')
  const canonical = await Promise.all(parsed.data.roots.map(async directory => {
    if (!path.isAbsolute(directory)) throw new Error('MCP roots must be absolute directories.')
    const resolved = await realpath(directory)
    if (!(await stat(resolved)).isDirectory()) throw new Error('MCP roots must be directories.')
    return { id: rootId(resolved), directory: resolved, name: path.basename(resolved) }
  }))
  const roots = [...new Map(canonical.map(root => [root.id, root])).values()]
  const configPath = await realpath(filename)
  if (roots.some(root => isWithin(root.directory, configPath))) throw new Error('Keep MCP credentials outside all scanned roots.')
  const clients: McpPolicy['clients'] = []
  for (const client of parsed.data.clients) {
    const granted = await Promise.all(client.roots.map(directory => realpath(directory)))
    const selected = roots.filter(root => granted.includes(root.directory))
    if (new Set(granted).size !== selected.length) throw new Error('Client roots must name configured roots.')
    const digest = createHash('sha256').update(client.token).digest()
    if (clients.some(other => other.principal.id === client.id || timingSafeEqual(other.digest, digest))) throw new Error('MCP clients need distinct IDs and credentials.')
    clients.push({ digest, principal: { id: client.id, roots: selected, capabilities: client.capabilities, disclosePaths: client.disclosePaths, discloseContent: client.discloseContent } })
  }
  return { roots, clients }
}
export function authenticate(policy: McpPolicy, header: string | undefined): Principal | undefined {
  if (!header || !/^Bearer [a-zA-Z0-9_-]{43,128}$/.test(header)) return undefined
  const digest = createHash('sha256').update(header.slice(7)).digest()
  return policy.clients.find(client => timingSafeEqual(client.digest, digest))?.principal
}
export function requireCapability(principal: Principal, name: Principal['capabilities'][number]) {
  if (!principal.capabilities.includes(name)) throw new McpFailure('CAPABILITY_DISABLED', 'This capability is disabled by local configuration.')
}
export function allowedRoot(principal: Principal, id: string): AllowedRoot {
  const root = principal.roots.find(root => root.id === id)
  if (!root) throw new McpFailure('ROOT_NOT_ALLOWED', 'This root is not authorized.')
  return root
}
