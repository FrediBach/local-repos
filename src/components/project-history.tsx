import { useEffect, useId, useState } from 'react'
import { GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommitFrequencyHeatmap } from '@/components/commit-frequency-heatmap'
import { CommitLog } from '@/components/commit-log'
import { projectHistory } from '@/lib/api'
import type { GitHistory, RepoProject } from '@/types'
import './project-history.css'

export function ProjectHistory({ project, helper, demo, onActivity }: { onActivity?: (id: string, data: GitHistory, author?: string) => void; project: RepoProject; helper: boolean; demo: boolean }) {
  const [branch, setBranch] = useState('')
  const [author, setAuthor] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ data?: GitHistory; loading: boolean; error?: string; key?: string }>({ loading: true })
  const key = `${project.id}:${JSON.stringify([branch, author, offset, revision])}`

  useEffect(() => {
    if (!helper || demo) return
    let active = true
    projectHistory(project.id, { branch, author, offset }).then(data => {
      if (active) {
        setState({ data, loading: false, key })
        if (!branch && offset === 0) {
          if (author) onActivity?.(project.id, data, author)
          else onActivity?.(project.id, data)
        }
      }
    }, error => {
      if (active) setState(previous => ({ ...previous, loading: false, key, error: error instanceof Error ? error.message : 'Could not load commit history.' }))
    })
    return () => { active = false }
  }, [project.id, helper, demo, branch, author, offset, revision, key, onActivity])

  const loading = state.loading || state.key !== key
  const data = state.data
  const reset = () => { setBranch(''); setAuthor(''); setOffset(0); setRevision(value => value + 1) }
  return <section className="project-history" aria-label="Commit history">
    <div className="maintenance-heading"><h3><GitCommitHorizontal size={17} />Commit history</h3>{helper && !demo && <Button variant="ghost" size="sm" disabled={loading} onClick={() => { setOffset(0); setRevision(value => value + 1) }} aria-label="Refresh commit history"><RefreshCw size={14} />Refresh</Button>}</div>
    {demo || !helper ? <p className="maintenance-empty">{demo ? 'Connect a directory with the local helper to explore commit history.' : 'Connect with the local helper to browse commit history by author and branch.'}</p> : <>
      <HistoryFilters data={data} branch={branch} author={author} onBranchChange={value => { setBranch(value); setOffset(0) }} onAuthorChange={value => { setAuthor(value); setOffset(0) }} onReset={reset} />
      <HistoryResult data={data} loading={loading} error={state.error} onRetry={reset} filtered={!!(branch || author)} monorepo={!!project.monorepo} onPageChange={setOffset} />
    </>}
  </section>
}

function HistoryResult({ data, loading, error, onRetry, filtered, monorepo, onPageChange }: {
  data?: GitHistory; loading: boolean; error?: string; onRetry: () => void; filtered: boolean; monorepo: boolean; onPageChange: (offset: number) => void
}) {
  if (loading) return <p className="history-loading" role="status"><LoaderCircle size={16} className="spinning" />Loading commit history…</p>
  if (error) return <div className="history-error" role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={onRetry}>Retry commit history</Button></div>
  if (!data) return null
  if (!data.available) return <p className="maintenance-empty">This project is not a Git repository.</p>
  return <>
    <CommitFrequencyHeatmap activity={data.activity} from={data.from} to={data.to} />
    <div className="commit-log-card"><div className="history-card-heading"><h4><GitCommitHorizontal size={16} />Commit log</h4><span>{data.total.toLocaleString()} {data.total === 1 ? 'commit' : 'commits'} · All time</span></div>
      {data.commits.length ? <CommitLog commits={data.commits} /> : <p className="history-empty">{filtered ? 'No commits match these filters.' : 'No commits yet.'}</p>}
      {data.total > 0 && <div className="history-pagination"><span role="status">{data.offset + (data.commits.length ? 1 : 0)}–{data.offset + data.commits.length} of {data.total.toLocaleString()}</span><div><Button variant="outline" size="sm" disabled={data.offset === 0} onClick={() => onPageChange(Math.max(0, data.offset - 25))}>Previous</Button><Button variant="outline" size="sm" disabled={!data.hasMore} onClick={() => onPageChange(data.offset + data.commits.length)}>Next</Button></div></div>}
    </div>
    <p className="history-note">{monorepo ? 'History covers the whole repository. ' : ''}Includes locally available branches and remote-tracking branches. {data.shallow && 'This is a shallow clone; only downloaded commits are shown.'}</p>
  </>
}

function HistoryFilters({ data, branch, author, onBranchChange, onAuthorChange, onReset }: {
  data?: GitHistory; branch: string; author: string; onBranchChange: (value: string) => void; onAuthorChange: (value: string) => void; onReset: () => void
}) {
  const id = useId()
  return <div className="history-filters">
    <label htmlFor={`${id}-branch`}><span><GitBranch size={13} />Branch</span><select id={`${id}-branch`} value={branch} onChange={event => onBranchChange(event.target.value)} disabled={!data?.available}>
      <option value="">All branches</option>{data?.branches.map(item => <option key={item.ref} value={item.ref}>{item.name}{item.remote ? ' (remote)' : ''}</option>)}
    </select></label>
    <label htmlFor={`${id}-author`}><span><UserRound size={13} />Author</span><select id={`${id}-author`} value={author} onChange={event => onAuthorChange(event.target.value)} disabled={!data?.available}>
      <option value="">All authors</option>{author && !data?.authors.some(item => item.email === author) && <option value={author}>{author}</option>}{data?.authors.map(item => <option key={item.email} value={item.email}>{item.name} &lt;{item.email}&gt;</option>)}
    </select></label>
    {(branch || author) && <Button variant="ghost" size="sm" onClick={onReset}>Clear filters</Button>}
  </div>
}
