import { DevReads } from './dev'
import express, { type Express } from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { HelperApplication } from '../application'
import { authenticate, type McpPolicy } from './policy'
import { createReadServer } from './server'
import { GitReads } from './git'

export function mountMcp(app: Express, application: HelperApplication, policy: McpPolicy) {
  const git = new GitReads(application.index)
  const dev = new DevReads(application)
  const handlers = new Map(policy.clients.map(({ principal }) => [principal.id, toNodeHandler(createMcpHandler(() => createReadServer(application, principal, git, dev), { legacy: 'stateless', maxRequestBodySize: 16 * 1024 }))]))
  const active = new Map<string, number>()
  app.all('/mcp', (request, response, next) => {
    const principal = authenticate(policy, request.get('authorization'))
    if (!principal) { response.status(401).json({ error: 'MCP authentication required.' }); return }
    if ((active.get(principal.id) ?? 0) >= 4) { response.status(429).json({ error: 'MCP concurrent request limit reached.' }); return }
    active.set(principal.id, (active.get(principal.id) ?? 0) + 1)
    response.locals.mcpPrincipal = principal.id
    // The reservation is released after handler completion, not disconnect: Git
    // work may still be running after a client has stopped waiting.
    express.json({ limit: '16kb' })(request, response, error => {
      if (error) {
        active.set(principal.id, active.get(principal.id)! - 1)
        response.status((error as { type?: string }).type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized MCP JSON body.' })
        return
      }
      void handlers.get(principal.id)!(request, response, request.body).catch(next).finally(() => { active.set(principal.id, active.get(principal.id)! - 1) })
    })
  })
}
