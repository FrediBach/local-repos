import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { readProtectedJson } from './policy'

const bridgeConfig = z.strictObject({
  url: z.string().default('http://127.0.0.1:4318/mcp'),
  token: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/),
})

/** A transport bridge only: no application, registry, scanner, or runtime. */
async function main() {
  const filename = process.env.LOCAL_REPOS_MCP_CLIENT_CONFIG
  if (!filename) throw new Error('Set LOCAL_REPOS_MCP_CLIENT_CONFIG to a protected client configuration file.')
  const config = bridgeConfig.parse(await readProtectedJson(filename))
  const url = new URL(config.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) throw new Error('The bridge requires http://127.0.0.1:<port>/mcp without credentials or query parameters.')
  const client = new Client({ name: 'local-repos-stdio-bridge', version: '0.5.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error' },
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input))
      if (target.origin !== url.origin || target.pathname !== '/mcp') throw new Error('The bridge refused a request outside the configured helper endpoint.')
      return fetch(input, { ...init, redirect: 'error' })
    },
  })
  try { await client.connect(transport, { timeout: 10_000 }) }
  catch { await client.close(); throw new Error('Cannot connect to the MCP helper. Start it with MCP enabled and check the credential, endpoint, and SDK compatibility.') }
  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'local-repos-stdio-bridge', version: '0.5.0' }, { capabilities: { tools: {}, resources: {} } })
    server.server.setRequestHandler('tools/list', request => client.listTools(request.params))
    server.server.setRequestHandler('tools/call', request => client.callTool(request.params))
    server.server.setRequestHandler('resources/list', request => client.listResources(request.params))
    server.server.setRequestHandler('resources/templates/list', request => client.listResourceTemplates(request.params))
    server.server.setRequestHandler('resources/read', request => client.readResource(request.params))
    return server
  }, { legacy: 'serve', onerror: () => console.error('MCP bridge protocol request failed.') })
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await handle.close()
    await client.close()
  }
  process.stdin.once('end', () => { void close() })
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })
}
main().catch(error => {
  // Zod errors may contain input; never print credential/config parsing details.
  console.error(error instanceof z.ZodError ? 'Invalid MCP client configuration.' : error instanceof Error ? error.message : 'MCP bridge startup failed.')
  process.exitCode = 1
})
