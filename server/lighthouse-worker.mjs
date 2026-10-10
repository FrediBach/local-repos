import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'

// Resolve Lighthouse's own logger even if npm stops hoisting its dependencies.
const require = createRequire(import.meta.url)
const lighthouseRequire = createRequire(require.resolve('lighthouse'))
const { default: log } = await import(pathToFileURL(lighthouseRequire.resolve('lighthouse-logger')).href)

let previousPhase = ''
const reportProgress = ([, message]) => {
  // Lighthouse's fixed status events identify real phase transitions. Never
  // relay raw log messages, navigation URLs, or page-controlled text.
  const phase = message === 'Generating results...' ? 'lighthouse-results'
    : message === 'Analyzing and running audits...' ? 'lighthouse-auditing'
      : typeof message === 'string' && message.startsWith('Navigating to ') ? 'lighthouse-navigation'
        : typeof message === 'string' && message.startsWith('Getting artifact: ') ? 'lighthouse-gathering' : undefined
  if (phase && phase !== previousPhase) {
    previousPhase = phase
    process.stderr.write(`LOCAL_REPOS_SCAN_PHASE:${phase}\n`)
  }
}
log.events.on('status', reportProgress)

// Chromium belongs to ProjectRuntime. Unlike the CLI, this API never launches
// another browser if its supplied debugging connection disappears.
try {
  const result = await lighthouse(process.argv[2], {
    port: Number(process.argv[3]), hostname: '127.0.0.1', logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    disableFullPageScreenshot: true,
    maxWaitForLoad: 45_000,
  }, desktopConfig)
  if (!result) throw new Error('Lighthouse returned no report.')
  const { lighthouseVersion, requestedUrl, finalDisplayedUrl, finalUrl, configSettings, runtimeError, runWarnings, categories, audits } = result.lhr
  for (const category of Object.values(categories)) {
    category.auditRefs = category.auditRefs.filter(audit => !['screenshot-thumbnails', 'final-screenshot'].includes(audit.id))
  }
  const ids = new Set(Object.values(categories).flatMap(category => category.auditRefs.map(audit => audit.id)))
  // Traces, filmstrips and full-page image data are not part of this report.
  process.stdout.write(JSON.stringify({ lighthouseVersion, requestedUrl, finalDisplayedUrl, finalUrl,
    configSettings: { formFactor: configSettings.formFactor }, runtimeError, runWarnings, categories,
    audits: Object.fromEntries([...ids].map(id => [id, audits[id]])) }))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lighthouse failed.')
  process.exitCode = 1
} finally {
  log.events.off('status', reportProgress)
}
