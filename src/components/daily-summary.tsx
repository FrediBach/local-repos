import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Copy, Download, FolderGit2, GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { projectDay } from '@/lib/api'
import { adjacentDay, branchCount, branchLabel, commitTime, dayRange, formatDailyReport, localDate, summaryCommits, summaryDate, summaryNotes, summaryRepositories, type SummaryRepository, type SummaryResult } from '@/lib/daily-summary'
import type { RepoProject } from '@/types'
import './daily-summary.css'

interface Props { projects: RepoProject[]; helper: boolean; onConnect: () => void }
interface CopyContext { key: string; author: string; projectId: string }

export function DailySummary({ projects, helper, onConnect }: Props) {
  const id = useId()
  const [day, setDay] = useState(localDate)
  const [author, setAuthor] = useState('')
  const [projectId, setProjectId] = useState('')
  const [revision, setRevision] = useState(0)
  const [copyFeedback, setCopyFeedback] = useState<{ context: CopyContext; status: 'copied' | 'error' }>()
  const copyRequest = useRef(0)
  const [state, setState] = useState<{ key: string; results: SummaryResult[] }>({ key: '', results: [] })
  const repositories = summaryRepositories(projects)
  const repositoryKey = JSON.stringify(repositories)
  const key = JSON.stringify([day, revision, repositoryKey, helper])
  // A fresh context also prevents old feedback reappearing when filters are restored.
  const copyContext = useMemo(() => ({ key, author, projectId }), [key, author, projectId])
  const copied = copyFeedback?.context === copyContext && copyFeedback.status === 'copied'
  const copyError = copyFeedback?.context === copyContext && copyFeedback.status === 'error'
  const range = dayRange(day)

  useEffect(() => {
    if (!helper) return
    const query = dayRange(day)
    if (!query) return
    let active = true
    const sources: SummaryRepository[] = JSON.parse(repositoryKey)
    let index = 0
    setState({ key, results: [] })
    // Keep large workspaces responsive without spawning a Git process for every
    // project at once. Requests already in flight cannot overwrite a newer day.
    void Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (active && index < sources.length) {
        const project = sources[index++]
        let result: SummaryResult
        try { result = { project, data: await projectDay(project.id, query) } }
        catch (error) { result = { project, error: error instanceof Error ? error.message : 'Could not load commits.' } }
        if (active) setState(previous => ({ key, results: [...previous.results, result] }))
      }
    }))
    return () => { active = false }
  }, [day, helper, repositoryKey, revision, key])

  useLayoutEffect(() => () => { copyRequest.current += 1 }, [copyContext])
  useEffect(() => {
    if (copyFeedback?.status !== 'copied') return
    const timer = setTimeout(() => setCopyFeedback(undefined), 2500)
    return () => clearTimeout(timer)
  }, [copyFeedback])

  const results = useMemo(() => state.key === key ? state.results : [], [state, key])
  const loading = helper && !!range && (state.key !== key || results.length < repositories.length)
  const allCommits = useMemo(() => summaryCommits(results), [results])
  const commits = useMemo(() => summaryCommits(results, projectId, author), [results, projectId, author])
  const authors = [...new Map(allCommits.map(commit => [commit.email, { name: commit.author, email: commit.email }])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const groups = repositories.map(project => ({ project, commits: commits.filter(commit => commit.project.id === project.id) })).filter(group => group.commits.length)
  const notes = summaryNotes(results)
  const report = range ? formatDailyReport(day, commits, results, author, projectId) : ''
  const failed = results.filter(result => result.error).length
  const canExport = helper && !!range && !loading && results.some(result => result.data)
  const changeDay = (value: string) => { setDay(value) }

  async function copyReport() {
    const request = ++copyRequest.current
    setCopyFeedback(undefined)
    try {
      await navigator.clipboard.writeText(report)
      if (request === copyRequest.current) setCopyFeedback({ context: copyContext, status: 'copied' })
    } catch {
      if (request === copyRequest.current) setCopyFeedback({ context: copyContext, status: 'error' })
    }
  }
  function downloadReport() {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `daily-summary-${day}.txt`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="daily-summary" aria-label="Daily summary">
    <div className="daily-heading"><div><span className="eyebrow"><CalendarDays size={14} /> THE DAY IN REVIEW</span><h2>A day’s work, in one place.</h2><p>Trace your progress. Prepare your report. Wrap up your bookings.</p></div><div className="daily-export"><Button variant="outline" size="sm" disabled={!canExport} onClick={() => void copyReport()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy summary'}</Button><Button variant="ghost" size="sm" disabled={!canExport} onClick={downloadReport}><Download size={15} />Download</Button></div></div>
    {!helper ? <div className="daily-empty"><CalendarDays size={30} /><h3>Your workday, brought together.</h3><p>Connect your projects with the local helper to see commits across every project and branch, with a timeline and a report you can copy.</p><Button variant="outline" onClick={onConnect}>Connect directory</Button></div> : <>
      <div className="daily-controls"><div className="daily-date"><label htmlFor={`${id}-date`}>Work day</label><div><Button variant="ghost" size="icon" disabled={!range} aria-label="Previous day" onClick={() => changeDay(adjacentDay(day, -1))}><ChevronLeft size={17} /></Button><input id={`${id}-date`} type="date" value={day} onChange={event => changeDay(event.target.value)} /><Button variant="ghost" size="icon" disabled={!range} aria-label="Next day" onClick={() => changeDay(adjacentDay(day, 1))}><ChevronRight size={17} /></Button><Button variant="ghost" size="sm" onClick={() => changeDay(localDate())}>Today</Button></div></div>
        <label htmlFor={`${id}-project`}>Project<select id={`${id}-project`} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">All projects</option>{repositories.map(project => <option key={project.id} value={project.id}>{project.name} · {project.relativePath}</option>)}</select></label>
        <label htmlFor={`${id}-author`}>Author<select id={`${id}-author`} value={author} onChange={event => setAuthor(event.target.value)}><option value="">All authors</option>{author && !authors.some(item => item.email === author) && <option value={author}>{author}</option>}{authors.map(item => <option key={item.email} value={item.email}>{item.name || item.email} &lt;{item.email}&gt;</option>)}</select></label>
        <Button variant="outline" size="sm" disabled={loading || !range} aria-label="Refresh daily summary" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} className={loading ? 'spinning' : ''} />Refresh</Button>
      </div>
      <p className="daily-timezone">{range ? summaryDate(day) : 'Choose a valid date.'}<span>Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p>
      {!range ? <p role="alert" className="daily-warning">Choose a valid work day to load its commits.</p> : loading ? <div className="daily-loading" role="status"><LoaderCircle size={20} className="spinning" /><span>Reading the day’s commits… {results.length} of {repositories.length} projects</span></div> : <>
        {notes.length > 0 && <div className="daily-warning" role="status"><strong>{failed ? `Summary incomplete · ${failed} ${failed === 1 ? 'project' : 'projects'} could not be read` : 'Some history is limited'}</strong><ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>{failed > 0 && <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Retry summary</Button>}</div>}
        <dl className="daily-stats"><div><dt><GitCommitHorizontal size={15} />Commits</dt><dd>{commits.length}</dd></div><div><dt><FolderGit2 size={15} />Projects</dt><dd>{groups.length}</dd></div><div><dt><GitBranch size={15} />Branches</dt><dd>{branchCount(commits)}</dd></div><div><dt><Clock3 size={15} />First / last commit</dt><dd className="daily-time-range">{commits.length ? <>{commitTime(commits[0].committedAt)} <span>→</span> {commitTime(commits[commits.length - 1].committedAt)}</> : '—'}</dd></div></dl>
        {commits.length ? <div className="daily-body"><section className="daily-projects" aria-label="Project summary"><div className="daily-section-heading"><h3>By project</h3><span>{groups.length} {groups.length === 1 ? 'project' : 'projects'}</span></div>{groups.map(group => <article className="daily-project" key={group.project.id}><div className="daily-project-heading"><h4>{group.project.name}</h4><span>{group.commits.length} {group.commits.length === 1 ? 'commit' : 'commits'}</span></div><p className="daily-project-path">{group.project.relativePath}</p><div className="daily-branches">{[...new Map(group.commits.flatMap(commit => commit.branches.map(branch => [branch.ref, branch] as const))).values()].map(branch => <span key={branch.ref}><GitBranch size={12} />{branchLabel(branch)}</span>)}</div><ul>{[...new Set(group.commits.map(commit => commit.message || '(No commit message)'))].map(message => <li key={message}>{message}</li>)}</ul><p className="daily-project-time"><Clock3 size={13} />{commitTime(group.commits[0].committedAt)} – {commitTime(group.commits[group.commits.length - 1].committedAt)}</p></article>)}</section>
          <section className="daily-timeline" aria-label="Commit timeline"><div className="daily-section-heading"><h3>Through the day</h3><span>Earliest first</span></div><ol>{commits.map(commit => <li key={`${commit.project.id}:${commit.hash}`}><time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString()}>{commitTime(commit.committedAt)}</time><div className="daily-timeline-marker" aria-hidden="true"><GitCommitHorizontal size={14} /></div><div className="daily-timeline-content"><span className="daily-timeline-project">{commit.project.name}</span><p>{commit.message || '(No commit message)'}</p><div className="daily-commit-meta"><code title={commit.hash}>{commit.hash.slice(0, 7)}</code><span title={commit.email}>{commit.author || commit.email || 'Unknown author'}</span></div><div className="daily-branches">{commit.branches.length ? commit.branches.map(branch => <span key={branch.ref}><GitBranch size={12} />{branchLabel(branch)}</span>) : <span>No containing branch (detached HEAD)</span>}</div></div></li>)}</ol></section></div> : <div className="daily-empty"><CalendarDays size={30} /><h3>{failed === results.length && failed > 0 ? 'The summary could not be loaded.' : 'No commits to show for this day.'}</h3><p>{failed > 0 ? 'Retry the unavailable projects to complete your summary.' : author || projectId ? 'Try another author, project, or day.' : 'Choose another day, or refresh after your next commit.'}</p>{(author || projectId) && <Button variant="outline" size="sm" onClick={() => { setAuthor(''); setProjectId('') }}>Clear summary filters</Button>}</div>}
        <p className="daily-footnote">Commit times are reference points, not hours worked. Includes locally available local and remote-tracking branches; uncommitted work is excluded. Branches shown contain the commits now; original branches may differ. Monorepo history is counted once.</p>
      </>}
      {copied && <p className="daily-copy-status" role="status">Summary copied for your report or bookings.</p>}
      {copyError && canExport && <div className="daily-copy-fallback"><p role="alert">Clipboard unavailable. Select the report below to copy it, or use Download.</p><textarea aria-label="Daily summary report" readOnly value={report} onFocus={event => event.currentTarget.select()} /></div>}
    </>}
  </section>
}
