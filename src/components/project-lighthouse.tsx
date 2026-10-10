import { useId, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Gauge, Info, LoaderCircle, Search } from 'lucide-react'
import Markdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { isLighthouseProject, lighthouseScoreLevel } from '@/lib/lighthouse'
import type { LighthouseAudit, LighthouseCategoryId, LighthouseReport, RepoProject } from '@/types'
import './project-react-doctor.css'
import './project-lighthouse.css'

const categoryTitles: Record<LighthouseCategoryId, string> = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' }
const categoryIds = Object.keys(categoryTitles) as LighthouseCategoryId[]
const metricIds = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'interaction-to-next-paint']

export function ProjectLighthouse({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string) => void
}) {
  const report = project.lighthouse
  const scanning = busy === `${project.id}:lighthouse`
  const eligible = isLighthouseProject(project)
  return <section className="lighthouse-section" aria-label="Lighthouse">
    <div className="maintenance-heading react-doctor-heading"><h3><Gauge size={18} /> Lighthouse</h3>
      <Button variant="outline" size="sm" disabled={!!busy || demo || !eligible} aria-busy={scanning} onClick={() => onAction('lighthouse')}>
        {scanning ? <LoaderCircle size={15} className="spinning" /> : <Gauge size={15} />}{scanning ? 'Scanning frontend…' : report ? 'Scan frontend again' : 'Run Lighthouse'}
      </Button>
    </div>
    <p className="maintenance-hint">{demo ? 'Connect a directory to scan your frontend projects.' : !eligible ? 'Lighthouse requires a recognized frontend development script or an explicit localRepos.previewUrl.' : helper ? 'Tests a frontend page in Chromium for performance, accessibility, best practices, and SEO. Uses the configured preview URL or starts the local app when needed. Pages load without a signed-in session.' : 'Connect with the local helper to scan your frontend with Lighthouse.'}</p>
    {scanning && <p className="react-doctor-scanning" role="status"><LoaderCircle size={15} className="spinning" />Testing the frontend. This can take a few minutes.{report ? ' Your previous results remain below.' : ''}</p>}
    {report ? <LighthouseResults key={report.scannedAt} report={report} /> : <div className="react-doctor-empty"><Gauge size={28} aria-hidden="true" /><h4>Understand your frontend.</h4><p>No Lighthouse scan yet. Run a scan to see page scores, performance measurements, and suggested improvements.</p></div>}
  </section>
}

function LighthouseResults({ report }: { report: LighthouseReport }) {
  const metrics = metricIds.flatMap(id => report.audits.find(audit => audit.id === id) ?? [])
  return <>
    <div className="lighthouse-scores" role="status" aria-label="Lighthouse scan result">{categoryIds.map(id => {
      const category = report.categories.find(value => value.id === id)
      const score = category?.score ?? null
      return <div className="lighthouse-category-score" key={id}><div className={`react-doctor-score react-doctor-level-${lighthouseScoreLevel(score)}`} role="img" aria-label={`${categoryTitles[id]}: ${score === null ? 'score unavailable' : `${score} out of 100`}`}>
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="react-doctor-score-track" cx="50" cy="50" r="43" /><circle className="react-doctor-score-fill" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${score ?? 0} 100`} /></svg>
        <div><strong>{score ?? '—'}</strong><span>{score === null ? 'NO SCORE' : 'OUT OF 100'}</span></div>
      </div><h4>{categoryTitles[id]}</h4></div>
    })}</div>
    <p className="react-doctor-results-hint">Higher scores indicate better results. 90–100: good · 50–89: needs improvement · 0–49: poor. Unavailable scores are shown as —.</p>
    <div className="lighthouse-page-meta"><span>{report.formFactor === 'mobile' ? 'Mobile' : 'Desktop'} page audit</span><PageUrl url={report.url} />{report.requestedUrl !== report.url && <span>Requested: <PageUrl url={report.requestedUrl} /></span>}</div>
    <p className="react-doctor-scan-meta">Last scan <time dateTime={report.scannedAt}>{new Date(report.scannedAt).toLocaleString()}</time><span>Lighthouse {report.version}</span></p>
    {!!report.warnings.length && <div className="react-doctor-notice" role="note" aria-label="Lighthouse scan notes"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Scan notes</strong>{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
    {!!metrics.length && <section aria-label="Performance measurements"><h4 className="lighthouse-section-title">Performance measurements</h4><div className="lighthouse-metrics">{metrics.map(audit => <div key={audit.id}><span>{audit.title}</span><strong className={`lighthouse-metric-value react-doctor-level-${lighthouseScoreLevel(audit.score === null ? null : audit.score * 100)}`}>{audit.displayValue || (audit.numericValue === undefined ? 'Unavailable' : `${audit.numericValue}${audit.numericUnit ? ` ${audit.numericUnit}` : ''}`)}</strong></div>)}</div><p className="react-doctor-results-hint">Lab measurements from this page load. Results vary with page content, device settings, and local machine load.</p></section>}
    <LighthouseAudits audits={report.audits} />
    <p className="maintenance-hint react-doctor-saved-note">Saved results for the tested page. Scan again after frontend changes. A configured preview URL may show a deployed version that differs from this checkout.</p>
  </>
}

function safeHttpUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

function PageUrl({ url }: { url: string }) {
  const href = safeHttpUrl(url)
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{url}<ExternalLink size={12} aria-hidden="true" /></a> : <span>{url}</span>
}

type AuditStatus = 'attention' | 'passed' | 'manual' | 'informative' | 'not-applicable' | 'unavailable'
const statusLabels: Record<AuditStatus, string> = { attention: 'Needs improvement', passed: 'Passed', manual: 'Manual checks', informative: 'Informative', 'not-applicable': 'Not applicable', unavailable: 'Unavailable' }
const statuses = Object.keys(statusLabels) as AuditStatus[]

function auditStatus(audit: LighthouseAudit): AuditStatus {
  if (audit.scoreDisplayMode === 'manual') return 'manual'
  if (audit.scoreDisplayMode === 'notApplicable') return 'not-applicable'
  if (audit.scoreDisplayMode === 'error') return 'unavailable'
  if (audit.score === null) return audit.scoreDisplayMode === 'informative' ? 'informative' : 'unavailable'
  return audit.score < 1 ? 'attention' : 'passed'
}

function LighthouseAudits({ audits }: { audits: LighthouseAudit[] }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AuditStatus | 'all'>('all')
  const [category, setCategory] = useState('')
  const search = query.trim().toLowerCase()
  const filtered = useMemo(() => audits.filter(audit => (status === 'all' || auditStatus(audit) === status) && (!category || audit.categories.some(value => value === category)) && (!search || [audit.id, audit.title, audit.description, audit.displayValue, audit.explanation].some(value => value?.toLowerCase().includes(search)))).sort((a, b) => statuses.indexOf(auditStatus(a)) - statuses.indexOf(auditStatus(b)) || a.title.localeCompare(b.title)), [audits, status, category, search])
  const hasFilters = !!query || status !== 'all' || !!category
  const clearFilters = () => { setQuery(''); setStatus('all'); setCategory('') }
  return <section className="react-doctor-findings" aria-label="Lighthouse audits">
    <div className="react-doctor-findings-heading"><h4>Audit details</h4><span>{audits.length} total</span></div>
    <div className="react-doctor-filters"><label className="react-doctor-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search Lighthouse audits</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search audits or guidance…" /></label><label className="react-doctor-category" htmlFor={`${id}-category`}><span className="sr-only">Audit category</span><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categoryIds.map(value => <option key={value} value={value}>{categoryTitles[value]}</option>)}</select></label></div>
    <div className="react-doctor-filter-row"><div className="react-doctor-severity-filters" role="group" aria-label="Audit status">{(['all', ...statuses] as const).map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'all' ? 'All' : statusLabels[value]}{' '}<span>{value === 'all' ? audits.length : audits.filter(audit => auditStatus(audit) === value).length}</span></button>)}</div>{hasFilters && <button type="button" className="react-doctor-clear" onClick={clearFilters}>Clear filters</button>}</div>
    <p className="react-doctor-results-hint" aria-live="polite">{filtered.length === audits.length ? 'Expand an audit for guidance and affected resources. Manual checks and unavailable audits need separate review.' : `${filtered.length} of ${audits.length} audits shown.`}</p>
    {filtered.length ? <div className="react-doctor-finding-list">{filtered.map(audit => <AuditDetails key={audit.id} audit={audit} />)}</div> : <div className="react-doctor-empty"><Info size={24} aria-hidden="true" /><h4>{audits.length ? 'No matching audits' : 'No audit details returned'}</h4><p>{audits.length ? 'Try another search or clear your filters.' : 'Review the scores and scan notes for checks that could not complete.'}</p>{hasFilters && <Button variant="outline" size="sm" onClick={clearFilters}>Show all audits</Button>}</div>}
  </section>
}

function AuditDetails({ audit }: { audit: LighthouseAudit }) {
  const status = auditStatus(audit)
  const Icon = status === 'attention' ? AlertTriangle : status === 'passed' ? CheckCircle2 : status === 'unavailable' ? AlertCircle : Info
  return <details className="react-doctor-finding lighthouse-audit"><summary><span className={`react-doctor-finding-icon lighthouse-audit-${status}`}><Icon size={18} /></span><span className="react-doctor-finding-copy"><span className="react-doctor-finding-message">{audit.title}</span><span className="react-doctor-finding-meta"><span className={`lighthouse-audit-${status}`}>{statusLabels[status]}</span>{audit.categories.map(category => <span key={category}>{categoryTitles[category]}</span>)}</span></span>{audit.displayValue && <span className="react-doctor-occurrence-count lighthouse-display-value">{audit.displayValue}</span>}<ChevronDown size={16} className="react-doctor-chevron" aria-hidden="true" /></summary>
    <div className="react-doctor-finding-detail"><div className="lighthouse-guidance"><Markdown skipHtml allowedElements={['p', 'a', 'code', 'strong', 'em', 'ul', 'ol', 'li']} unwrapDisallowed urlTransform={url => safeHttpUrl(url) ?? ''} components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{audit.description}</Markdown></div>{audit.explanation && <p className="lighthouse-explanation">{audit.explanation}</p>}
      {audit.details && !!audit.details.headings.length && !!audit.details.items.length && <div className="lighthouse-audit-table" role="region" aria-label={`${audit.title} affected resources`} tabIndex={0}><table><thead><tr>{audit.details.headings.map(heading => <th key={heading.key} scope="col">{heading.label}</th>)}</tr></thead><tbody>{audit.details.items.map((item, index) => <tr key={index}>{audit.details!.headings.map(heading => <td key={heading.key}>{item[heading.key] || '—'}</td>)}</tr>)}</tbody></table></div>}
      {!!audit.details?.omitted && <p className="react-doctor-results-hint">{audit.details.omitted} additional {audit.details.omitted === 1 ? 'row omitted' : 'rows omitted'} from the saved report.</p>}
      <p className="react-doctor-rule-source">Audit: <code>{audit.id}</code>{audit.score !== null && ` · Score: ${Math.round(audit.score * 100)}/100`}</p>
    </div>
  </details>
}
