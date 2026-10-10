import { createApp, HELPER_PORT } from './app'
import { loadPolicy } from './mcp/policy'

const { app, application } = createApp({ mcpPolicy: await loadPolicy(process.env.LOCAL_REPOS_MCP_CONFIG), operationLogger: event => console.error('[local-repos:mcp]', JSON.stringify(event)) })
const server = app.listen(HELPER_PORT, '127.0.0.1', () => {
  console.log(`Local Repos helper is listening at http://127.0.0.1:${HELPER_PORT}`)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${HELPER_PORT} is already in use. Stop the other helper before starting this one.` : error.message)
  process.exitCode = 1
})

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  server.close()
  await application.shutdown()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
