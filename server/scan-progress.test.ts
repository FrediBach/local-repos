import { EventEmitter } from 'node:events'
import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { ScanProgressReporter } from '../src/types'
import { createProgressTask, followProgress, respondWithScan } from './scan-progress'

class StreamingResponse extends EventEmitter {
  headersSent = false
  destroyed = false
  writableEnded = false
  writableNeedDrain = false
  chunks: string[] = []
  type = vi.fn()
  write(chunk: string) { this.headersSent = true; this.chunks.push(chunk); return !this.writableNeedDrain }
  end() { this.writableEnded = true }
}

const request = { get: () => 'application/x-ndjson' } as unknown as Request

describe('scan progress transport and subscriptions', () => {
  it('coalesces backpressure into the latest stage, flushes it on drain, and removes listeners on completion', async () => {
    const response = new StreamingResponse()
    let report!: ScanProgressReporter
    let finish!: (value: string) => void
    const pending = respondWithScan(request, response as unknown as Response, onProgress => {
      report = onProgress!
      return new Promise<string>(resolve => { finish = resolve })
    })
    response.writableNeedDrain = true
    report({ phase: 'Checking configuration' })
    report({ phase: 'Waiting for the registry' })
    expect(response.chunks).toEqual([])
    response.writableNeedDrain = false
    response.emit('drain')
    expect(response.chunks.map(chunk => JSON.parse(chunk))).toEqual([{ type: 'progress', progress: { phase: 'Waiting for the registry' } }])
    response.writableNeedDrain = true
    report({ phase: 'Preparing findings' })
    finish('complete')
    await pending
    expect(response.chunks.slice(-2).map(chunk => JSON.parse(chunk))).toEqual([
      { type: 'progress', progress: { phase: 'Preparing findings' } }, { type: 'result', result: 'complete' },
    ])
    expect(response.listenerCount('drain')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })

  it('drops pending stages and response listeners when a client disconnects', async () => {
    const response = new StreamingResponse()
    let report!: ScanProgressReporter
    let finish!: () => void
    const pending = respondWithScan(request, response as unknown as Response, onProgress => {
      report = onProgress!
      return new Promise<void>(resolve => { finish = resolve })
    })
    response.writableNeedDrain = true
    report({ phase: 'Checking packages' })
    response.destroyed = true
    response.emit('close')
    response.writableNeedDrain = false
    response.emit('drain')
    report({ phase: 'Preparing findings' })
    finish()
    await pending
    expect(response.chunks).toEqual([])
    expect(response.listenerCount('drain')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })

  it('isolates a failing subscriber and removes every follower when the operation rejects', async () => {
    let report!: ScanProgressReporter
    let fail!: (error: Error) => void
    const task = createProgressTask(onProgress => {
      report = onProgress
      return new Promise<never>((_resolve, reject) => { fail = reject })
    })
    const broken = vi.fn(() => { throw new Error('Consumer disconnected') })
    const healthy = vi.fn()
    const first = followProgress(task, broken)
    const second = followProgress(task, healthy)
    const settled = Promise.allSettled([first, second])
    await Promise.resolve()
    expect(() => report({ phase: 'Checking packages' })).not.toThrow()
    fail(new Error('Registry unavailable'))
    expect(await settled).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ message: 'Registry unavailable' }) },
      { status: 'rejected', reason: expect.objectContaining({ message: 'Registry unavailable' }) },
    ])
    report({ phase: 'Late progress' })
    expect(broken).toHaveBeenCalledOnce()
    expect(healthy).toHaveBeenCalledExactlyOnceWith({ phase: 'Checking packages' })
  })
})
