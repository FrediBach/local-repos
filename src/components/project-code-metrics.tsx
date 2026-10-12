import { ChartNoAxesCombined } from 'lucide-react'
import { useId, useState } from 'react'
import type { CodeMetrics } from '@/types'
import './project-code-metrics.css'

const colors = ['var(--accent)', 'var(--info)', 'var(--warm)', 'var(--muted-foreground)', 'var(--primary)']
const format = (value: number) => value.toLocaleString()

export function ProjectCodeMetrics({ report, demo }: { report?: CodeMetrics; demo: boolean }) {
  return <section className="code-metrics" aria-label="Code metrics">
    <div className="maintenance-heading"><h3><ChartNoAxesCombined size={16} /> Lines of code</h3></div>
    {!report ? <p className="maintenance-empty">{demo ? 'Connect a directory to measure its code.' : 'Resync your directory to collect code metrics.'}</p> : <>
      <div className="code-metrics-summary">
        <div><strong>{format(report.totalLines)}</strong><span>{report.partial ? 'lines counted · partial scan' : 'lines of code'}</span></div>
        <p>{format(report.totalFiles)} source {report.totalFiles === 1 ? 'file' : 'files'}<br />{report.languages.length} code {report.languages.length === 1 ? 'type' : 'types'}</p>
      </div>
      <FileStatistics report={report} />
      {report.totalLines > 0 ? <figure className="code-metrics-chart">
        <figcaption>Lines by code type</figcaption>
        <div className="code-metrics-composition" aria-hidden="true">{report.languages.filter(row => row.lines > 0).map((row, index) => <span key={row.name} style={{ width: `${row.lines / report.totalLines * 100}%`, background: colors[index % colors.length] }} />)}</div>
        <ul>{report.languages.map((row, index) => <li key={row.name}>
          <div className="code-metrics-label"><span>{row.name}</span><span><strong>{format(row.lines)}</strong> <small>{(row.lines / report.totalLines * 100).toFixed(1)}%</small></span></div>
          <div className="code-metrics-track" aria-hidden="true"><span style={{ width: `${row.lines / Math.max(...report.languages.map(item => item.lines)) * 100}%`, background: colors[index % colors.length] }} /></div>
        </li>)}</ul>
      </figure> : <p className="maintenance-empty">{report.partial ? 'No source lines could be counted in this partial scan.' : 'No nonblank lines found in recognized source files.'}</p>}
      {report.partial && <div className="code-metrics-warning" role="status">{report.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <p className="maintenance-hint">Last scan · {new Date(report.scannedAt).toLocaleString()}. Resync your directory to refresh.</p>
    </>}
    <p className="maintenance-hint">Nonblank lines, including comments, grouped by file type. Includes source, markup, styles, and configuration. Respects .gitignore; skips dependency and build folders, lockfiles, binaries, and unrecognized file types. Project totals include child packages.</p>
  </section>
}

function FileStatistics({ report }: { report: CodeMetrics }) {
  const id = useId()
  const [type, setType] = useState('')
  const selected = report.languages.find(row => row.name === type)
  const statistics = selected ? selected.fileStatistics : report.fileStatistics
  const files = selected ? selected.files : report.totalFiles
  const lines = selected ? selected.lines : report.totalLines
  const values = [
    ['Files', files], ['Lines', lines], ['Average', statistics?.average],
    ['Minimum', statistics?.min], ['Maximum', statistics?.max], ['Median', statistics?.median],
  ] as const

  return <section className="code-file-statistics" aria-label="File statistics">
    <div className="code-file-statistics-heading">
      <h4>Lines per file</h4>
      <label htmlFor={`${id}-type`}>File type <select id={`${id}-type`} value={selected?.name ?? ''} onChange={event => setType(event.target.value)}>
        <option value="">All file types</option>
        {report.languages.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}
      </select></label>
    </div>
    <dl className="code-file-statistics-grid">{values.map(([label, value]) => <div key={label}>
      <dt>{label}</dt><dd>{value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd>
    </div>)}</dl>
    <p className="maintenance-hint">{!statistics ? 'Resync your directory to collect per-file statistics.' : !files ? 'No source files were counted in this selection.' : `Based on ${selected?.name ?? 'all'} source files${report.partial ? ' successfully read in this partial scan' : ''}. Empty and blank-only files count as zero lines.`}</p>
  </section>
}
