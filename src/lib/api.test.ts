import { afterEach, expect, it, vi } from 'vitest'
import { api, setHelperWorkspacePath } from './api'

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
