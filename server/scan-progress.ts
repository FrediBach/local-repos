import type { Request, Response } from 'express'
import type { ScanProgress, ScanProgressReporter } from '../src/types'
import { HelperError } from './scanner'

export function scanError(error: unknown): { error: string; status: number } {
  if (error instanceof HelperError) return { error: error.message, status: error.status }
  if (error instanceof SyntaxError) return { error: 'The request body must be valid JSON.', status: 400 }
  console.error('[local-repos]', error)
  return { error: 'The local helper could not complete this action. Check its terminal for details.', status: 500 }
}

/** Progress belongs to this response; disconnecting never cancels shared work. */
export async function respondWithScan<T>(request: Request, response: Response, run: (onProgress?: ScanProgressReporter) => Promise<T>): Promise<void> {
  const streaming = request.get('accept')?.split(',').some(value => value.trim().split(';')[0] === 'application/x-ndjson' && !/;\s*q=0(?:\.0*)?(?:;|$)/.test(value))
  if (!streaming) {
    response.json(await run())
    return
  }
  const write = (event: unknown) => {
    if (response.destroyed || response.writableEnded) return
    if (!response.headersSent) response.type('application/x-ndjson')
    response.write(`${JSON.stringify(event)}\n`)
  }
  let pending: ScanProgress | undefined
  let closed = false
  const flush = () => {
    if (!pending || response.writableNeedDrain) return
    const progress = pending
    pending = undefined
    write({ type: 'progress', progress })
  }
  const cleanup = () => {
    closed = true
    pending = undefined
    response.off('drain', flush)
    response.off('close', cleanup)
  }
  response.on('drain', flush)
  response.once('close', cleanup)
  try {
    const result = await run(progress => {
      // Slow or disconnected readers must not accumulate every intermediate
      // update, block the scan, or interfere with another subscriber.
      if (closed) return
      pending = progress
      flush()
    })
    if (pending) write({ type: 'progress', progress: pending })
    write({ type: 'result', result })
    response.end()
  } catch (error) {
    // Keep ordinary HTTP errors (including unknown-project retries) intact
    // until progress actually starts the response.
    if (!response.headersSent) throw error
    write({ type: 'error', ...scanError(error) })
    response.end()
  } finally {
    cleanup()
  }
}

export interface ProgressTask<T> extends Promise<T> {
  subscribe: (reporter?: ScanProgressReporter) => () => void
}

/** A deduplicated operation shares its latest phase with every active caller. */
export function createProgressTask<T>(run: (report: ScanProgressReporter) => Promise<T>): ProgressTask<T> {
  const reporters = new Set<ScanProgressReporter>()
  let latest: ScanProgress | undefined
  const notify = (reporter: ScanProgressReporter, progress: ScanProgress) => {
    try { reporter(progress) } catch { /* A disconnected consumer cannot fail shared work. */ }
  }
  const promise = Promise.resolve().then(() => run(progress => {
    latest = progress
    for (const reporter of reporters) notify(reporter, progress)
  }))
  return Object.assign(promise, {
    subscribe(reporter?: ScanProgressReporter) {
      if (!reporter) return () => undefined
      reporters.add(reporter)
      if (latest) notify(reporter, latest)
      return () => { reporters.delete(reporter) }
    },
  })
}

export async function followProgress<T>(task: ProgressTask<T>, reporter?: ScanProgressReporter): Promise<T> {
  const unsubscribe = task.subscribe(reporter)
  try { return await task }
  finally { unsubscribe() }
}
