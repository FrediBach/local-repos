import { useId, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, FileCode2, LoaderCircle, Search, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isReactProject, reactDoctorScoreLevel } from '@/lib/react-doctor'
import type { ReactDoctorFinding, ReactDoctorReport, RepoProject } from '@/types'
import './project-react-doctor.css'

export function ProjectReactDoctor({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const report = project.reactDoctor
  const scanning = busy === `${project.id}:react-doctor`
  const eligible = isReactProject(project)

  return <section className="react-doctor-section" aria-label="React Doctor">
    <div className="maintenance-heading react-doctor-heading"><h3><Stethoscope size={18} /> React Doctor</h3>
      <Button variant="outline" size="sm" disabled={!!busy || demo || !eligible} aria-busy={scanning} onClick={() => onAction('react-doctor')}>
        {scanning ? <LoaderCircle size={15} className="spinning" /> : <Stethoscope size={15} />}
        {scanning ? 'Scanning React code…' : report ? 'Scan React again' : 'Run React Doctor'}
      </Button>
    </div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to scan your React projects.' : !eligible ? 'React Doctor is available for repositories that use React.' : helper ? 'Analyzes React source locally for performance, correctness, and maintainability issues. Diagnostic details are sent to React Doctor to calculate the score. Scanning does not change your files.' : 'Connect with the local helper to scan your React code.'}</p>
    {scanning && <p className="react-doctor-scanning" role="status"><LoaderCircle size={15} className="spinning" />Analyzing React code. This can take a few minutes.{report ? ' Your previous results remain below.' : ''}</p>}
    {report && eligible ? <DoctorReport key={report.scannedAt} report={report} /> : <div className="react-doctor-empty">
      <Stethoscope size={28} aria-hidden="true" /><h4>React code, a little healthier.</h4>
      <p>No React Doctor scan yet. Run a scan to see a score, suggested improvements, and exactly where to find them.</p>
    </div>}
  </section>
}

function DoctorReport({ report }: { report: ReactDoctorReport }) {
  return <>
    <DoctorScoreSummary report={report} />
    <p className="react-doctor-scan-meta">Last scan <time dateTime={report.scannedAt}>{new Date(report.scannedAt).toLocaleString()}</time><span>React Doctor {report.version}</span></p>
    {report.warning && <div className="react-doctor-notice" role="note" aria-label="React Doctor scan notes"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Scan notes</strong><p>{report.warning}</p></div></div>}
    {report.findings.length ? <DoctorFindings findings={report.findings} /> : <DoctorEmptyResult incomplete={!!report.warning} />}
    <p className="maintenance-hint react-doctor-saved-note">Saved results from this scan. Scan again after source or dependency changes.</p>
  </>
}

function DoctorScoreSummary({ report }: { report: ReactDoctorReport }) {
  const errors = report.findings.filter(finding => finding.severity === 'error').length
  const warnings = report.findings.length - errors
  const fileCount = new Set(report.findings.map(finding => finding.filePath).filter(Boolean)).size
  return <div className="react-doctor-result" role="status" aria-label="React Doctor scan result">
      <DoctorScore score={report.score} />
      <div className="react-doctor-result-copy"><span className="react-doctor-kicker">REACT CODE HEALTH</span><h4>{report.label}</h4>
        <p>{report.score === null ? 'The scan did not return a score. Review the findings and scan notes below.' : 'Higher scores indicate healthier React code.'}</p>
        <div className="react-doctor-stats"><span className={errors ? 'react-doctor-error' : ''}><AlertCircle size={14} />{errors} {errors === 1 ? 'error' : 'errors'}</span><span className={warnings ? 'react-doctor-warning' : ''}><AlertTriangle size={14} />{warnings} {warnings === 1 ? 'warning' : 'warnings'}</span><span><FileCode2 size={14} />{fileCount} {fileCount === 1 ? 'file' : 'files'}</span></div>
      </div>
    </div>
}

function DoctorScore({ score }: { score: number | null }) {
  return <div className={`react-doctor-score react-doctor-level-${reactDoctorScoreLevel(score)}`} role="img" aria-label={score === null ? 'Score unavailable' : `React Doctor score: ${score} out of 100`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="react-doctor-score-track" cx="50" cy="50" r="43" /><circle className="react-doctor-score-fill" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${score ?? 0} 100`} /></svg>
    <div><strong>{score ?? '—'}</strong><span>{score === null ? 'NO SCORE' : 'OUT OF 100'}</span></div>
  </div>
}

function DoctorEmptyResult({ incomplete }: { incomplete: boolean }) {
  return <div className="react-doctor-empty react-doctor-empty-result">
    {incomplete ? <AlertCircle size={25} aria-hidden="true" /> : <CheckCircle2 size={25} aria-hidden="true" />}
    <h4>{incomplete ? 'No findings returned' : 'No issues reported'}</h4><p>{incomplete ? 'Review the scan notes for checks that may not have completed.' : 'React Doctor found no issues in the code it checked.'}</p>
  </div>
}

type SeverityFilter = 'all' | ReactDoctorFinding['severity']
interface FindingGroup { key: string; finding: ReactDoctorFinding; occurrences: ReactDoctorFinding[] }

function categoryOf(finding: ReactDoctorFinding) { return finding.category.trim() || 'General' }

function groupFindings(findings: ReactDoctorFinding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>()
  for (const finding of findings) {
    const key = JSON.stringify([finding.severity, categoryOf(finding), finding.plugin, finding.rule, finding.message, finding.help])
    const existing = groups.get(key)
    if (existing) existing.occurrences.push(finding)
    else groups.set(key, { key, finding, occurrences: [finding] })
  }
  return [...groups.values()].sort((a, b) => Number(b.finding.severity === 'error') - Number(a.finding.severity === 'error') || b.occurrences.length - a.occurrences.length || a.finding.message.localeCompare(b.finding.message))
}

function DoctorFindings({ findings }: { findings: ReactDoctorFinding[] }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [category, setCategory] = useState('')
  const categories = [...new Set(findings.map(categoryOf))].sort()
  const search = query.trim().toLowerCase()
  const filtered = useMemo(() => findings.filter(finding => (severity === 'all' || finding.severity === severity)
    && (!category || categoryOf(finding) === category)
    && (!search || [finding.message, finding.help, finding.rule, finding.plugin, finding.filePath, finding.category].some(value => value.toLowerCase().includes(search)))), [findings, severity, category, search])
  const groups = useMemo(() => groupFindings(filtered), [filtered])
  const hasFilters = !!query || severity !== 'all' || !!category
  const clearFilters = () => { setQuery(''); setSeverity('all'); setCategory('') }

  return <section className="react-doctor-findings" aria-label="React Doctor findings">
    <div className="react-doctor-findings-heading"><h4>Findings</h4><span>{findings.length} total</span></div>
    <div className="react-doctor-filters">
      <label className="react-doctor-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search React Doctor findings</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search findings, rules, or files…" /></label>
      <label className="react-doctor-category" htmlFor={`${id}-category`}><span className="sr-only">Finding category</span><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <div className="react-doctor-filter-row"><div className="react-doctor-severity-filters" role="group" aria-label="Finding severity">
      {(['all', 'error', 'warning'] as const).map(value => <button type="button" key={value} aria-pressed={severity === value} onClick={() => setSeverity(value)}>{value === 'all' ? 'All' : value === 'error' ? 'Errors' : 'Warnings'}{' '}<span>{value === 'all' ? findings.length : findings.filter(finding => finding.severity === value).length}</span></button>)}
    </div>{hasFilters && <button type="button" className="react-doctor-clear" onClick={clearFilters}>Clear filters</button>}</div>
    <p className="react-doctor-results-hint" aria-live="polite">{filtered.length === findings.length ? 'Expand a finding for guidance and file locations.' : `${filtered.length} of ${findings.length} findings shown.`}</p>
    {groups.length ? <div className="react-doctor-finding-list">{groups.map(group => <FindingDetails key={group.key} group={group} />)}</div>
      : <div className="react-doctor-empty"><Search size={24} aria-hidden="true" /><h4>No matching findings</h4><p>Try another search or clear your filters to see all findings.</p><Button variant="outline" size="sm" onClick={clearFilters}>Show all findings</Button></div>}
  </section>
}

function FindingDetails({ group }: { group: FindingGroup }) {
  const { finding, occurrences } = group
  const isError = finding.severity === 'error'
  return <details className="react-doctor-finding">
    <summary><span className={`react-doctor-finding-icon react-doctor-${finding.severity}`}>{isError ? <AlertCircle size={18} /> : <AlertTriangle size={18} />}</span>
      <span className="react-doctor-finding-copy"><span className="react-doctor-finding-message">{finding.message}</span><span className="react-doctor-finding-meta"><span className={`react-doctor-${finding.severity}`}>{isError ? 'Error' : 'Warning'}</span><span>{categoryOf(finding)}</span><code>{finding.rule}</code></span></span>
      <span className="react-doctor-occurrence-count">{occurrences.length} {occurrences.length === 1 ? 'location' : 'locations'}</span><ChevronDown size={16} className="react-doctor-chevron" aria-hidden="true" />
    </summary>
    <div className="react-doctor-finding-detail">
      {finding.help && <div className="react-doctor-guidance"><strong>How to improve</strong><p>{finding.help}</p></div>}
      <div className="react-doctor-locations"><h5><FileCode2 size={14} />{occurrences.length === 1 ? 'File location' : 'File locations'}</h5><ul>{occurrences.map((item, index) => <li key={`${item.filePath}:${item.line}:${item.column}:${index}`}><code>{item.filePath || 'Project-level finding'}{item.line > 0 ? `:${item.line}${item.column > 0 ? `:${item.column}` : ''}` : ''}</code></li>)}</ul></div>
      {finding.plugin && <p className="react-doctor-rule-source">Rule: <code>{finding.plugin}/{finding.rule}</code></p>}
    </div>
  </details>
}
