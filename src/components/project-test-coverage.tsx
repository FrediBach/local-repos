import { useMemo, useState } from 'react'
import { AlertTriangle, FileCode2, LoaderCircle, Search, TestTubeDiagonal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canInspectCoverage, coverageLevel, coveragePercent, coverageRunnerLabels, detectCoverageRunner, formatCoveragePercent } from '@/lib/test-coverage'
import type { CoverageMetric, CoverageMetrics, CoverageRunner, RepoProject, TestCoverageReport } from '@/types'
import './project-test-coverage.css'

const metricNames: (keyof CoverageMetrics)[] = ['lines', 'statements', 'functions', 'branches']
const metricLabels = { lines: 'Lines', statements: 'Statements', functions: 'Functions', branches: 'Branches' }

function coverageActionLabel(scanning: boolean, native: boolean, hasReport: boolean): string {
  if (scanning) return 'Scanning coverage…'
  if (!native) return 'Import coverage report'
  return hasReport ? 'Scan coverage again' : 'Run coverage scan'
}

function CoverageHint({ demo, helper, runner }: { demo: boolean; helper: boolean; runner: CoverageRunner | null }) {
  let hint = 'Imports an existing Istanbul JSON summary or LCOV report from your project. Generate coverage with your test setup first; importing does not run tests.'
  if (demo) hint = 'Connect a directory to measure coverage in your projects.'
  else if (!helper) hint = 'Connect with the local helper to run tests or import a coverage report.'
  else if (runner && runner !== 'report') {
    hint = `Runs your installed ${coverageRunnerLabels[runner]} tests locally with coverage enabled. Tests can execute project setup and write files.`
    if (runner === 'vitest') hint += ' Missing coverage providers are prepared in the Local Repos cache without changing project dependencies. First-time setup needs npm and network access.'
  }
  return <p className="maintenance-hint">{hint}</p>
}

export function ProjectTestCoverage({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const report = project.testCoverage
  const scanning = busy === `${project.id}:test-coverage`
  const runner = detectCoverageRunner(project)
  const native = !!runner && runner !== 'report'
  return <section className="test-coverage-section" aria-label="Test coverage">
    <div className="maintenance-heading test-coverage-heading"><h3><TestTubeDiagonal size={18} /> Test coverage</h3>
      <Button variant="outline" size="sm" disabled={!!busy || demo || !canInspectCoverage(project)} aria-busy={scanning} onClick={() => onAction('test-coverage')}>
        {scanning ? <LoaderCircle size={15} className="spinning" /> : <TestTubeDiagonal size={15} />}
        {coverageActionLabel(scanning, native, !!report)}
      </Button>
    </div>
    <CoverageHint demo={demo} helper={helper} runner={runner} />
    {scanning && <p className="test-coverage-scanning" role="status"><LoaderCircle size={15} className="spinning" />{native ? 'Running tests and collecting coverage. This can take a few minutes.' : 'Looking for an existing coverage report.'}{runner === 'vitest' ? ' First-time scans may prepare missing coverage tools.' : ''}{report ? ' Your previous results remain below.' : ''}</p>}
    {report ? <CoverageReport key={report.scannedAt} report={report} /> : <div className="test-coverage-empty"><TestTubeDiagonal size={28} aria-hidden="true" /><h4>See where tests reach.</h4><p>No coverage scan yet. Run Vitest, Jest, or Create React App coverage, or import a report from tools such as Cypress and Playwright.</p></div>}
  </section>
}

function CoverageReport({ report }: { report: TestCoverageReport }) {
  return <>
    <div className="coverage-metrics" role="group" aria-label="Coverage totals">{metricNames.map(name => <CoverageMetricSummary key={name} name={name} metric={report.metrics[name]} />)}</div>
    <div className="coverage-report-meta">
      <p><strong>{report.source === 'run' ? 'Tests run' : 'Existing report imported'}</strong> <time dateTime={report.scannedAt}>{new Date(report.scannedAt).toLocaleString()}</time><span>{coverageRunnerLabels[report.runner]}</span></p>
      {report.source === 'existing-report' && <p>{report.reportModifiedAt ? <>Report modified <time dateTime={report.reportModifiedAt}>{new Date(report.reportModifiedAt).toLocaleString()}</time>. </> : 'Report age unknown. '}Tests were not run by this scan; coverage may predate your current code.</p>}
      {report.reportPath && <p>Report <code>{report.reportPath}</code></p>}
      {report.command && <p>Command <code>{report.command}</code></p>}
      {report.tooling && <p role="note" aria-label="Coverage tooling">Coverage provider <code>{report.tooling.packageName}@{report.tooling.version}</code> supplied from the Local Repos cache.</p>}
    </div>
    {(report.warning || (report.exitCode !== undefined && report.exitCode !== 0)) && <div className="coverage-notice" role="note" aria-label="Coverage scan notes"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Scan notes</strong>{report.exitCode !== undefined && report.exitCode !== 0 && <p>The test command exited with code {report.exitCode}. Coverage is available, but tests or coverage thresholds may have failed.</p>}{report.warning && <p>{report.warning}</p>}</div></div>}
    <div className="coverage-scope-note"><strong>Coverage scope matters</strong><p>These totals describe the files included in the report. Untested files may be excluded; configure Vitest <code>coverage.include</code> or Jest <code>collectCoverageFrom</code> to include untested source files. Coverage shows which code ran, not whether tests made useful assertions.</p></div>
    <CoverageFiles files={report.files} />
    <p className="maintenance-hint coverage-saved-note">Saved coverage results. Scan again after changing source code, tests, or coverage configuration.</p>
  </>
}

function metricDescription(metric: CoverageMetric | null): string {
  return metric === null ? 'Not reported' : metric.total === 0 ? 'No measurable items' : `${metric.covered.toLocaleString()} of ${metric.total.toLocaleString()} covered`
}

function CoverageMetricSummary({ name, metric }: { name: keyof CoverageMetrics; metric: CoverageMetric | null }) {
  const pct = coveragePercent(metric)
  return <div className={`coverage-metric coverage-level-${coverageLevel(metric)}`}>
    <h4>{metricLabels[name]}</h4><strong aria-label={`${metricLabels[name]}: ${pct === null ? 'coverage unavailable' : formatCoveragePercent(metric)}`}>{formatCoveragePercent(metric)}</strong>
    <div className="coverage-meter" aria-hidden="true"><span style={{ width: `${pct ?? 0}%` }} /></div><p>{metricDescription(metric)}</p>
  </div>
}

type FileSort = 'uncovered' | 'coverage' | 'path'
function uncoveredLines(metric: CoverageMetric | null): number | null { return metric && metric.total > 0 ? metric.total - metric.covered : null }

function CoverageFiles({ files }: { files: TestCoverageReport['files'] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FileSort>('uncovered')
  const [gapsOnly, setGapsOnly] = useState(false)
  const [limit, setLimit] = useState(100)
  const filtered = useMemo(() => files.filter(file => file.path.toLowerCase().includes(query.trim().toLowerCase())
    && (!gapsOnly || metricNames.some(name => (file.metrics[name]?.total ?? 0) > (file.metrics[name]?.covered ?? 0))))
    .sort((a, b) => (sort === 'uncovered' ? (uncoveredLines(b.metrics.lines) ?? -1) - (uncoveredLines(a.metrics.lines) ?? -1)
      : sort === 'coverage' ? (coveragePercent(a.metrics.lines) ?? Infinity) - (coveragePercent(b.metrics.lines) ?? Infinity) : 0)
      || a.path.localeCompare(b.path)), [files, query, sort, gapsOnly])
  const visible = filtered.slice(0, limit)
  const clear = () => { setQuery(''); setGapsOnly(false); setLimit(100) }
  return <section className="coverage-files" aria-label="Coverage by file">
    <div className="coverage-files-heading"><h4><FileCode2 size={16} /> Coverage by file</h4><span>{files.length.toLocaleString()} {files.length === 1 ? 'file' : 'files'}</span></div>
    {files.length ? <>
      <div className="coverage-filters">
        <label className="coverage-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search coverage files</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(100) }} placeholder="Search files…" /></label>
        <label className="coverage-sort"><span className="sr-only">Sort coverage files</span><select value={sort} onChange={event => { setSort(event.target.value as FileSort); setLimit(100) }}><option value="uncovered">Most uncovered lines</option><option value="coverage">Lowest line coverage</option><option value="path">File name</option></select></label>
      </div>
      <label className="coverage-gaps-filter"><input type="checkbox" checked={gapsOnly} onChange={event => { setGapsOnly(event.target.checked); setLimit(100) }} /> Only files with coverage gaps</label>
      <p className="coverage-file-count" aria-live="polite">Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} {filtered.length === files.length ? 'files' : `matching files (${files.length.toLocaleString()} total)`}.</p>
      {filtered.length ? <div className="coverage-table-scroll" role="region" aria-label="File coverage table" tabIndex={0}><table className="coverage-table"><thead><tr><th scope="col">File</th>{metricNames.map(name => <th scope="col" key={name}>{metricLabels[name]}</th>)}<th scope="col">Uncovered lines</th></tr></thead><tbody>{visible.map(file => <tr key={file.path}><th scope="row"><code>{file.path}</code></th>{metricNames.map(name => <td key={name} className={`coverage-text-${coverageLevel(file.metrics[name])}`} title={metricDescription(file.metrics[name])}>{formatCoveragePercent(file.metrics[name])}</td>)}<td>{uncoveredLines(file.metrics.lines)?.toLocaleString() ?? '—'}</td></tr>)}</tbody></table></div>
        : <div className="test-coverage-empty"><Search size={24} aria-hidden="true" /><h4>No matching files</h4><p>Try another search or show all files.</p><Button variant="outline" size="sm" onClick={clear}>Show all files</Button></div>}
      {visible.length < filtered.length && <Button variant="outline" size="sm" className="coverage-show-more" onClick={() => setLimit(value => value + 100)}>Show {Math.min(100, filtered.length - visible.length)} more files</Button>}
    </> : <p className="coverage-no-files">This report contains totals only. Generate a report with file details to find coverage gaps.</p>}
  </section>
}
