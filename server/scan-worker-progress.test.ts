import { execFile } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { observeScanProgress, withoutScanProgress } from './scan-worker-progress'

describe('bounded scan progress side channel', () => {
  it('handles split chunks, deduplicates phases, and never relays arbitrary tool output', () => {
    const stream = new PassThrough()
    const progress = vi.fn()
    observeScanProgress(stream, progress)
    stream.write('A private path from a tool\nLOCAL_REPOS_SCAN_PHASE:doctor-')
    stream.write('lint\nLOCAL_REPOS_SCAN_PHASE:doctor-lint\nLOCAL_REPOS_SCAN_PHASE:untrusted-stage\n')
    stream.write('x'.repeat(10_000))
    stream.write('\nLOCAL_REPOS_SCAN_PHASE:doctor-score\n')
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual([
      'Running React lint and code analysis', 'Requesting the React health score',
    ])
    expect(JSON.stringify(progress.mock.calls)).not.toContain('private')
    stream.end()
  })

  it('removes only recognized progress records from diagnostic warnings', () => {
    expect(withoutScanProgress('Warning\nLOCAL_REPOS_SCAN_PHASE:doctor-lint\nLOCAL_REPOS_SCAN_PHASE:unknown\n')).toBe('Warning\nLOCAL_REPOS_SCAN_PHASE:unknown\n')
  })

  it('reports the actual scoring request only for the fixed React Doctor endpoint', async () => {
    const observer = fileURLToPath(new URL('./react-doctor-progress.mjs', import.meta.url))
    const { stderr, stdout } = await promisify(execFile)(process.execPath, ['--import', observer, '--input-type=module', '-e', `
      import { channel } from 'node:diagnostics_channel'
      const event = channel('undici:request:create')
      event.publish({ request: { origin: 'https://private.example', path: '/api/score' } })
      event.publish({ request: { origin: 'https://www.react.doctor', path: '/api/other' } })
      event.publish({ request: { origin: 'https://www.react.doctor', path: '/api/score?ci=1' } })
      process.stdout.write('report remains separate')
    `], { timeout: 10_000 })
    expect(stderr).toBe('LOCAL_REPOS_SCAN_PHASE:doctor-score\n')
    expect(stdout).toBe('report remains separate')
  })
})
