import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelperApplication } from '../application'
import { DevReads } from './dev'
import type { Principal } from './policy'

let app: HelperApplication
let dev: DevReads
const principal: Principal = { id: 'reader', capabilities: ['read'], roots: [{ id: 'root_test', name: 'Projects', directory: '/projects' }], discloseContent: true, disclosePaths: false }
beforeEach(() => {
  app = new HelperApplication()
  app.registry.register([{ directory: '/projects/app', root: '/projects', project: { id: 'project', name: 'App', dirName: 'app', relativePath: 'app', stack: [], description: '', scripts: {}, packageManager: 'npm', scannedAt: '' } }])
  dev = new DevReads(app)
})
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await app.shutdown() })

describe('bounded development logs', () => {
  it('freezes UTF-8 pages across appends, sanitizes content and rejects cross-principal or tampered cursors', () => {
    const read = vi.spyOn(app.runtime, 'logSnapshot').mockReturnValue({ text: '😀'.repeat(20) + '\u001b[31mtoken=secret-value /projects/app', truncated: false, processGeneration: undefined })
    const first = dev.logs(principal, 'project', { maxBytes: 7 })
    expect(first.text).toBe('😀')
    expect(first.nextCursor).toBeTruthy()
    read.mockReturnValue({ text: 'new output', truncated: false, processGeneration: undefined })
    let page = first
    let text = first.text
    while (page.nextCursor) { page = dev.logs(principal, 'project', { cursor: page.nextCursor, maxBytes: 16 }); text += page.text }
    expect(text).toBe('😀'.repeat(20) + 'token=[redacted] [Projects]/app')
    expect(() => dev.logs(principal, 'project', { cursor: first.nextCursor! + 'x' })).toThrow(/cursor/i)
    const other = { ...principal, id: 'other' }
    dev.logs(other, 'project', { maxBytes: 4 })
    expect(() => dev.logs(other, 'project', { cursor: first.nextCursor! })).toThrow(/cursor/i)
    expect(dev.logs(principal, 'project', {}).text).toBe('new output')
  })

  it('bounds retained snapshots, expires cursors, and requires content disclosure', () => {
    vi.useFakeTimers()
    vi.spyOn(app.runtime, 'logSnapshot').mockReturnValue({ text: '😀'.repeat(50_000), truncated: true, processGeneration: undefined })
    const first = dev.logs(principal, 'project', { maxBytes: 16384 })
    expect(Buffer.byteLength(first.text)).toBe(16384)
    expect(first.truncated).toBe(true)
    expect(() => dev.logs({ ...principal, discloseContent: false }, 'project', {})).toThrow(/disclosure/)
    vi.advanceTimersByTime(5 * 60_000 + 1)
    expect(() => dev.logs(principal, 'project', { cursor: first.nextCursor! })).toThrow(/expired/)
  })
})
