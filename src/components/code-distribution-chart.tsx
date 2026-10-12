import { useId } from 'react'
import type { CodeLineBucket } from '@/types'

const format = (value: number) => value.toLocaleString()
const range = (bucket: CodeLineBucket) => bucket.minLines === bucket.maxLines ? format(bucket.minLines) : `${format(bucket.minLines)}–${format(bucket.maxLines)}`

export function CodeDistributionChart({ buckets, type, partial }: { buckets?: CodeLineBucket[]; type: string; partial: boolean }) {
  const id = useId()
  if (!buckets) return <p className="maintenance-hint">Resync your directory to collect the file-size distribution.</p>
  if (!buckets.length) return <p className="maintenance-empty">No counted files to plot.</p>

  const maxFiles = Math.max(...buckets.map(bucket => bucket.files))
  const tickStep = Math.max(1, Math.ceil(maxFiles / 4))
  const ceiling = tickStep * 4
  const left = 54
  const top = 30
  const width = 646
  const height = 160
  const barWidth = width / buckets.length
  const dense = buckets.length > 10
  const gap = dense ? 1 : 6
  const labelStep = Math.ceil(buckets.length / 10)
  const boundaries = [...buckets.map((_, index) => index).filter(index => index % labelStep === 0 && index < buckets.length - labelStep * 0.75), buckets.length]
  const description = buckets.map(bucket => `${range(bucket)} lines: ${format(bucket.files)} ${bucket.files === 1 ? 'file' : 'files'}`).join('; ')

  return <figure className="code-distribution">
    <figcaption>File size distribution{partial && <span> · partial scan</span>}</figcaption>
    <div className="code-distribution-scroll" role="region" aria-label="Scrollable file size distribution" tabIndex={0}>
      <svg viewBox="0 0 720 260" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>File size distribution for {type}</title>
        <desc id={`${id}-description`}>Lines of code per file on the x axis; number of files on the y axis. {description}.</desc>
        <text x={left} y={14} className="code-distribution-axis-title">Files</text>
        {Array.from({ length: 5 }, (_, index) => {
          const value = index * tickStep
          const y = top + height - value / ceiling * height
          return <g key={value}><line x1={left} x2={left + width} y1={y} y2={y} className="code-distribution-gridline" /><text x={left - 10} y={y + 4} textAnchor="end">{format(value)}</text></g>
        })}
        {buckets.map((bucket, index) => {
          const x = left + index * barWidth
          const barHeight = bucket.files / ceiling * height
          return <g key={bucket.minLines}>
            <title>{range(bucket)} lines: {format(bucket.files)} {bucket.files === 1 ? 'file' : 'files'}</title>
            <rect x={x + gap / 2} y={top + height - barHeight} width={barWidth - gap} height={barHeight} rx={dense ? 0 : 2} className="code-distribution-bar" />
            {!dense && bucket.files > 0 && <text x={x + barWidth / 2} y={top + height - barHeight - 7} textAnchor="middle" className="code-distribution-count">{format(bucket.files)}</text>}
            {!dense && <text x={x + barWidth / 2} y={208} textAnchor="middle">{format(bucket.minLines)}{bucket.minLines !== bucket.maxLines && <><tspan>–</tspan><tspan x={x + barWidth / 2} dy={14}>{format(bucket.maxLines)}</tspan></>}</text>}
          </g>
        })}
        {dense && boundaries.map(index => <g key={index}>
          <line x1={left + index * barWidth} x2={left + index * barWidth} y1={top + height} y2={top + height + 5} className="code-distribution-gridline" />
          <text x={left + index * barWidth} y={212} textAnchor={index === 0 ? 'start' : index === buckets.length ? 'end' : 'middle'}>{format(index === buckets.length ? buckets[index - 1].maxLines + 1 : buckets[index].minLines)}</text>
        </g>)}
        <line x1={left} x2={left} y1={top} y2={top + height} className="code-distribution-gridline" />
        <text x={left + width / 2} y={248} textAnchor="middle" className="code-distribution-axis-title">Lines of code per file</text>
      </svg>
    </div>
    <details className="code-distribution-data"><summary>View file counts by range</summary>
      <table><caption className="sr-only">File size distribution for {type}</caption><thead><tr><th scope="col">Lines per file</th><th scope="col">Files</th></tr></thead><tbody>{buckets.map(bucket => <tr key={bucket.minLines}><th scope="row">{range(bucket)}</th><td>{format(bucket.files)}</td></tr>)}</tbody></table>
    </details>
  </figure>
}
