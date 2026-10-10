import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'

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
}
