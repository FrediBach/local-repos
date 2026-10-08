import { useEffect, useId, useState } from 'react'
import { GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommitFrequencyHeatmap } from '@/components/commit-frequency-heatmap'
import { CommitLog } from '@/components/commit-log'
import { projectHistory } from '@/lib/api'
import type { GitHistory, RepoProject } from '@/types'
import './project-history.css'

export function ProjectHistory({ project, helper, demo }: { project: RepoProject; helper: boolean; demo: boolean }) {
  const id = useId()
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
      if (active) setState({ data, loading: false, key })
    }, error => {
      if (active) setState(previous => ({ ...previous, loading: false, key, error: error instanceof Error ? error.message : 'Could not load commit history.' }))
    })
    return () => { active = false }
  }, [project.id, helper, demo, branch, author, offset, revision, key])

  const loading = state.loading || state.key !== key
  const data = state.data
  const hasResult = !loading && !state.error && data
  const reset = () => { setBranch(''); setAuthor(''); setOffset(0); setRevision(value => value + 1) }
  return <section className="project-history" aria-label="Commit history">
    <div className="maintenance-heading"><h3><GitCommitHorizontal size={17} />Commit history</h3>{helper && !demo && <Button variant="ghost" size="sm" disabled={loading} onClick={() => { setOffset(0); setRevision(value => value + 1) }} aria-label="Refresh commit history"><RefreshCw size={14} />Refresh</Button>}</div>
    {demo || !helper ? <p className="maintenance-empty">{demo ? 'Connect a directory with the local helper to explore commit history.' : 'Connect with the local helper to browse commit history by author and branch.'}</p> : <>
      <div className="history-filters">
        <label htmlFor={`${id}-branch`}><span><GitBranch size={13} />Branch</span><select id={`${id}-branch`} value={branch} onChange={event => { setBranch(event.target.value); setOffset(0) }} disabled={!data?.available}>
          <option value="">All branches</option>{data?.branches.map(item => <option key={item.ref} value={item.ref}>{item.name}{item.remote ? ' (remote)' : ''}</option>)}
        </select></label>
        <label htmlFor={`${id}-author`}><span><UserRound size={13} />Author</span><select id={`${id}-author`} value={author} onChange={event => { setAuthor(event.target.value); setOffset(0) }} disabled={!data?.available}>
          <option value="">All authors</option>{author && !data?.authors.some(item => item.email === author) && <option value={author}>{author}</option>}{data?.authors.map(item => <option key={item.email} value={item.email}>{item.name} &lt;{item.email}&gt;</option>)}
        </select></label>
        {(branch || author) && <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>}
      </div>
      {loading ? <p className="history-loading" role="status"><LoaderCircle size={16} className="spinning" />Loading commit history…</p> : state.error ? <div className="history-error" role="alert"><p>{state.error}</p><Button variant="outline" size="sm" onClick={reset}>Retry commit history</Button></div> : hasResult && !data.available ? <p className="maintenance-empty">This project is not a Git repository.</p> : hasResult && <>
        <CommitFrequencyHeatmap activity={data.activity} from={data.from} to={data.to} />
        <div className="commit-log-card"><div className="history-card-heading"><h4><GitCommitHorizontal size={16} />Commit log</h4><span>{data.total.toLocaleString()} {data.total === 1 ? 'commit' : 'commits'} · All time</span></div>
          {data.commits.length ? <CommitLog commits={data.commits} /> : <p className="history-empty">{branch || author ? 'No commits match these filters.' : 'No commits yet.'}</p>}
          {data.total > 0 && <div className="history-pagination"><span role="status">{data.offset + (data.commits.length ? 1 : 0)}–{data.offset + data.commits.length} of {data.total.toLocaleString()}</span><div><Button variant="outline" size="sm" disabled={data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - 25))}>Previous</Button><Button variant="outline" size="sm" disabled={!data.hasMore} onClick={() => setOffset(data.offset + data.commits.length)}>Next</Button></div></div>}
        </div>
        <p className="history-note">{project.monorepo ? 'History covers the whole repository. ' : ''}Includes locally available branches and remote-tracking branches. {data.shallow && 'This is a shallow clone; only downloaded commits are shown.'}</p>
      </>}
    </>}
  </section>
}
