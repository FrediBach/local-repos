import { Clock3, GitCommitHorizontal, UserRound } from 'lucide-react'
import type { GitCommit } from '@/types'

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function relativeDate(date: string) {
  const seconds = (Date.parse(date) - Date.now()) / 1000
  const unit = Math.abs(seconds) < 3600 ? 'minute' : Math.abs(seconds) < 86400 ? 'hour' : 'day'
  const value = Math.round(seconds / (unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400))
  return relativeTimeFormatter.format(value, unit)
}

// Local adaptation of https://www.shadcn.io/blocks/changelog-commit-log.
export function CommitLog({ commits }: { commits: GitCommit[] }) {
  return <ol className="commit-log" aria-label="Commit log">{commits.map(commit => <li key={commit.hash}>
    <div className="commit-log-marker" aria-hidden="true"><GitCommitHorizontal size={16} /></div>
    <div className="commit-log-content"><div className="commit-log-heading"><code title={commit.hash}>{commit.hash.slice(0, 7)}</code><strong>{commit.message || '(No commit message)'}</strong></div>
      <div className="commit-log-meta"><span className="commit-author" title={commit.email}><UserRound size={12} />{commit.author || commit.email || 'Unknown author'}</span><time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString()}><Clock3 size={12} />{relativeDate(commit.committedAt)}</time></div>
    </div>
  </li>)}</ol>
}
