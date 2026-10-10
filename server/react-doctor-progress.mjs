import { subscribe } from 'node:diagnostics_channel'
import { createRequire } from 'node:module'
import path from 'node:path'

// The CLI's JSON mode suppresses terminal progress. Observe real tool activity
// in this child only, without changing React Doctor's configuration or report.
// Unknown future worker names simply retain the combined analysis phase.
const require = createRequire(import.meta.url)
const directory = path.dirname(require.resolve('react-doctor'))
const lintWorker = path.join(directory, 'oxlint-worker.js')
const analysisWorker = path.join(directory, 'project-analysis-worker.js')
const report = phase => process.stderr.write(`LOCAL_REPOS_SCAN_PHASE:${phase}\n`)

subscribe('child_process', ({ process: child }) => {
  child.once('spawn', () => {
    if (child.spawnargs?.includes(analysisWorker)) report('doctor-structure')
    else if (child.spawnargs?.includes(lintWorker)) report('doctor-lint')
  })
})

subscribe('undici:request:create', ({ request }) => {
  if (request.origin === 'https://www.react.doctor' && /^\/api\/score(?:\?|$)/.test(request.path)) report('doctor-score')
})
