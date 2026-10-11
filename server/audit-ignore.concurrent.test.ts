import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { readAuditIgnores } from './audit-ignore'

const fs = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }))
vi.mock('node:fs/promises', () => fs)

const info = { isFile: () => true, size: 100, ino: 1, dev: 1 }
const id = 'CVE-2026-12345'
function handle(contents: string, wait = Promise.resolve()) {
  return {
    stat: vi.fn().mockResolvedValue(info),
    read: vi.fn(async (buffer: Buffer) => { await wait; return { bytesRead: buffer.write(contents) } }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => { vi.resetAllMocks(); fs.lstat.mockResolvedValue(info) })

it('reads both files concurrently but retains duplicate-rule and warning order', async () => {
  let release!: () => void
  const first = handle(`${id} # first\ninvalid-first`, new Promise<void>(resolve => { release = resolve }))
  const second = handle(`${id} # second\ninvalid-second`)
  fs.open.mockImplementation(async (filename: string) => path.basename(filename) === '.trivyignore' ? first : second)
  const pending = readAuditIgnores('/projects')
  try {
    await vi.waitFor(() => { expect(first.read).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce() })
  } finally { release() }
  const result = await pending
  expect(first.close).toHaveBeenCalledOnce()
  expect(result.rules.get(id)).toEqual({ source: '.trivignore', ids: [id], reason: 'second' })
  expect(result.warnings.map(warning => warning.split(':')[0])).toEqual(['.trivyignore', '.trivignore'])
})

it('waits for every handle to close on failure and reports errors in file order', async () => {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const first = handle(id, wait)
  first.read.mockImplementation(async () => { await wait; throw new Error('read failed') })
  const second = handle(id)
  second.stat.mockResolvedValue({ ...info, ino: 2 })
  fs.open.mockImplementation(async (filename: string) => path.basename(filename) === '.trivyignore' ? first : second)
  const finished = vi.fn()
  const pending = readAuditIgnores('/projects').then(() => undefined, (error: unknown) => error).finally(finished)
  try {
    await vi.waitFor(() => { expect(first.read).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce() })
    expect(finished).not.toHaveBeenCalled()
  } finally { release() }
  const error = await pending
  expect(error).toMatchObject({ message: expect.stringContaining('Cannot read .trivyignore.') })
  expect(first.close).toHaveBeenCalledOnce()
})
