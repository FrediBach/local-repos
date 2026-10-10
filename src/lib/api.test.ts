import { afterEach, expect, it, vi } from 'vitest'
import { api, projectAction, scanWithHelper, setHelperWorkspacePath } from './api'

afterEach(() => { setHelperWorkspacePath(); vi.unstubAllGlobals() })
const missing = { ok: false, status: 404, json: async () => ({ error: 'Project not found. Sync its folder again.' }) }

it('lazily registers cached projects for user actions after a helper restart', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ audit: { findings: [] } }) })
  vi.stubGlobal('fetch', fetch)
  setHelperWorkspacePath('/projects')
  expect(await api('/projects/alpha/audit', {})).toEqual({ audit: { findings: [] } })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/projects/alpha/audit', '/api/scan', '/api/projects/alpha/audit'])
})

it('never rescans from background status polling', async () => {
  const fetch = vi.fn().mockResolvedValue(missing)
  vi.stubGlobal('fetch', fetch)
  setHelperWorkspacePath('/projects')
  await expect(api('/projects/alpha/status')).rejects.toThrow('Project not found')
  expect(fetch).toHaveBeenCalledOnce()
})

function streamed(...chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } })
}

it('delivers progress across split frames before receiving a scan result', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  let delivered!: () => void
  const progress = new Promise<void>(resolve => { delivered = resolve })
  const onProgress = vi.fn(() => delivered())
  const result = projectAction('alpha', 'react-doctor', {}, onProgress)
  stream.enqueue(new TextEncoder().encode('{"type":"pro'))
  stream.enqueue(new TextEncoder().encode('gress","progress":{"phase":"Analyzing source","detail":"48 files"}}\n'))
  await progress
  expect(onProgress).toHaveBeenCalledExactlyOnceWith({ phase: 'Analyzing source', detail: '48 files' })
  expect(fetch).toHaveBeenCalledWith('/api/projects/alpha/react-doctor', expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/x-ndjson', 'X-Local-Repos': '1' }) }))
  stream.enqueue(new TextEncoder().encode('{"type":"result","result":{"reactDoctor":{"score":90}}}\n'))
  stream.close()
  await expect(result).resolves.toEqual({ reactDoctor: { score: 90 } })
})

it('accepts regular JSON from helpers that do not support progress', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { headers: { 'Content-Type': 'application/json' } })))
  await expect(scanWithHelper('/projects', vi.fn())).resolves.toEqual({ projects: [] })
})

it.each([
  ['{"type":"progress","progress":{"phase":"Auditing"}}\n', 'disconnected'],
  ['{"type":"error","error":"Audit timed out.","status":500}\n', 'Audit timed out.'],
  ['{"type":"progress","progress":{}}\n', 'invalid scan response'],
  ['{"type":"result",', 'invalid scan response'],
])('rejects incomplete, failed, or malformed scan streams', async (body, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(body)))
  await expect(projectAction('alpha', 'audit', {}, vi.fn())).rejects.toThrow(message)
})

it('re-registers after a streamed missing-project error and preserves the progress callback', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(streamed('{"type":"error","error":"Project not found. Sync its folder again.","status":404}\n'))
    .mockResolvedValueOnce(streamed('{"type":"result","result":{"projects":[]}}\n'))
    .mockResolvedValueOnce(streamed('{"type":"progress","progress":{"phase":"Auditing packages"}}\n{"type":"result","result":{"audit":{}}}\n'))
  vi.stubGlobal('fetch', fetch)
  setHelperWorkspacePath('/projects')
  const onProgress = vi.fn()
  await expect(projectAction('alpha', 'audit', {}, onProgress)).resolves.toEqual({ audit: {} })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/projects/alpha/audit', '/api/scan', '/api/projects/alpha/audit'])
  expect(onProgress).toHaveBeenLastCalledWith({ phase: 'Auditing packages' })
})

it('does not retry streamed errors from status polling', async () => {
  const fetch = vi.fn().mockResolvedValue(streamed('{"type":"error","error":"Project not found. Sync its folder again.","status":404}\n'))
  vi.stubGlobal('fetch', fetch)
  setHelperWorkspacePath('/projects')
  await expect(api('/projects/alpha/status', undefined, true, vi.fn())).rejects.toThrow('Project not found')
  expect(fetch).toHaveBeenCalledOnce()
})


it('allows the full fresh-audit and bounded-install deadline before timing out a vulnerability fix', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packageUpdate: {} }) }))
  try {
    await projectAction('alpha', 'fix-vulnerability', { name: 'alpha', title: 'Unsafe input', range: '<1.5.0' })
    expect(timeout).toHaveBeenCalledWith(540_000)
  } finally { timeout.mockRestore() }
})
