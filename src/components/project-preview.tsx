import { ArrowUpRight, AudioLines, Box, Circle, Command, FolderGit2, Plus, Search } from 'lucide-react'
import type { RepoProject } from '@/types'
import { useState } from 'react'

export function ProjectPreview({ project, large = false }: { project: RepoProject; large?: boolean }) {
  const [failedImage, setFailedImage] = useState<string>()
  if (project.screenshot && failedImage !== project.screenshot) return <div className={`project-preview screenshot-preview ${large ? 'large' : ''}`}><img src={project.screenshot} alt={`Screenshot of ${project.name}`} loading="lazy" onError={() => setFailedImage(project.screenshot)} /></div>
  const type = project.id.replace('demo-', '')
  const demo = project.id.startsWith('demo-')
  return <div className={`project-preview preview-${demo ? type : 'empty'} ${large ? 'large' : ''}`}>
    {type === 'form' ? <div className="mini-portfolio"><div className="mini-nav"><span>F / F</span><span>Work &nbsp; About &nbsp; Contact ↗</span></div><div className="portfolio-copy">Good things.<br /><i>Made with care.</i></div><div className="portfolio-object"><span /><span /><span /></div><span className="mini-bottom">INDEPENDENT DESIGN & DEVELOPMENT</span></div>
      : type === 'margin' ? <div className="mini-margin"><div className="margin-side"><b>m.</b><span>All notes</span><span>Personal</span><span>Ideas</span><span>Archive</span><Plus size={11} /></div><div className="margin-page"><span className="mini-eyebrow">THOUGHTS / 004</span><h4>Leave a little<br />room for thought.</h4><p>Not everything needs to be something.<br />Sometimes, a blank page is enough.</p><div className="mini-lines"><i /><i /><i /></div></div></div>
      : type === 'sunday' ? <div className="mini-sunday"><div className="mini-nav"><b>sunday supply</b><span>Objects &nbsp; Our story &nbsp; Bag (0)</span></div><div className="sunday-content"><div><span className="mini-eyebrow">FEWER, BETTER THINGS</span><h4>For the<br />everyday.</h4><span className="mini-link">Explore the collection ↗</span></div><div className="vase"><span /></div></div></div>
      : type === 'orbit' ? <div className="mini-orbit"><div className="orbit-side"><Circle size={14} /><div /><div /><div /></div><div className="orbit-main"><div className="mini-nav"><b>Overview</b><span>Last 30 days ▾</span></div><div className="mini-metrics"><div><span>Total revenue</span><b>$24,680</b><small>↗ 12.8%</small></div><div><span>Active users</span><b>1,842</b><small>↗ 8.2%</small></div></div><div className="mini-chart">{[22, 35, 27, 49, 41, 55, 45, 67, 54, 70, 62, 88, 72, 83, 95, 84, 100, 91].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div></div></div>
      : type === 'field' ? <div className="mini-field"><div className="mini-nav"><b>field notes</b><span>A journal of the outside ↗</span></div><div className="field-photo"><div className="hill hill-back" /><div className="hill hill-front" /><div className="sun" /><span>Take the long way home.</span></div><div className="field-caption"><span>NO. 012 — SOMEWHERE SLOW</span><span>5 MIN READ</span></div></div>
      : type === 'toolbox' ? <div className="mini-tools"><div className="mini-nav"><b><Box size={11} /> little tools</b><span>Useful, by design.</span></div><h4>A little help goes a long way.</h4><div className="tool-tiles"><div><Command /><span>Shortcuts</span></div><div><AudioLines /><span>Focus timer</span></div><div><Search /><span>Color picker</span></div></div></div>
      : <div className="preview-placeholder"><FolderGit2 size={32} strokeWidth={1.2} /><span>{project.dirName}</span><small>No preview captured</small></div>}
    {demo && <span className="demo-preview-label">EXAMPLE PREVIEW</span>}
    <span className="preview-open"><ArrowUpRight size={16} /></span>
  </div>
}
