import type { Readable } from 'node:stream'
import type { ScanProgress, ScanProgressReporter } from '../src/types'

const prefix = 'LOCAL_REPOS_SCAN_PHASE:'
const phases: Record<string, ScanProgress> = {
  'doctor-lint': { phase: 'Running React lint and code analysis', detail: 'Checking React rules, source structure and maintainability' },
  'doctor-structure': { phase: 'Checking code structure and dead code', detail: 'Analyzing source files; React lint checks can run alongside this stage' },
  'doctor-score': { phase: 'Requesting the React health score', detail: 'Waiting for the scoring service to evaluate the findings' },
  'lighthouse-navigation': { phase: 'Loading the page for Lighthouse' },
  'lighthouse-gathering': { phase: 'Collecting browser performance and page data' },
  'lighthouse-auditing': { phase: 'Evaluating Lighthouse audit checks' },
  'lighthouse-results': { phase: 'Calculating Lighthouse category scores' },
}

/** Only fixed phase tokens from our workers can become user-facing progress. */
export function observeScanProgress(stream: Readable | null, onProgress: ScanProgressReporter): void {
  let pending = ''
  let previous = ''
  stream?.on('data', (chunk: Buffer | string) => {
    // Logs may contain arbitrarily long lines. Retain only a bounded tail,
    // separately from execFile's existing bounded stdout/stderr collection.
    pending += String(chunk)
    for (const line of pending.split(/\r?\n/).slice(0, -1)) {
      const token = line.startsWith(prefix) ? line.slice(prefix.length) : ''
      if (Object.hasOwn(phases, token) && token !== previous) {
        previous = token
        onProgress(phases[token])
      }
    }
    pending = pending.slice(pending.lastIndexOf('\n') + 1).slice(-256)
  })
}

export function withoutScanProgress(stderr: string): string {
  return stderr.split(/\r?\n/).filter(line => !line.startsWith(prefix) || !Object.hasOwn(phases, line.slice(prefix.length))).join('\n')
}
