import { useState } from 'react'
import { ArrowUpRight, HardDrive, LoaderCircle, Monitor, Play, Square, Terminal } from 'lucide-react'
import { Button } from './ui/button'
import { selectDevScript } from '../lib/dev-script'
import { ProjectScripts } from './project-scripts'
import type { PreviewMode, RepoProject } from '../types'

interface ProjectControlsProps {
  project: RepoProject
  helper: boolean
  demo: boolean
  busy: string
  logs?: string
  onAction: (action: string, body?: unknown) => void
}

export function ProjectControls({ project, helper, demo, busy, logs, onAction }: ProjectControlsProps) {
  const [source, setSource] = useState<PreviewMode>('auto')
  const script = selectDevScript(project)
  const running = project.dev?.status === 'running' || project.dev?.status === 'starting'
  const projectUrl = project.previewUrl || project.homepage
  const preview = project.preview
  const previewKind = preview?.kind ?? 'screenshot'
  const previewLabel = previewKind === 'screenshot' ? 'Captured' : previewKind === 'og-image' ? 'Open Graph image' : previewKind === 'logo' ? 'Logo' : 'Favicon'
  const sourceLabel = preview?.source === 'local' ? 'local app' : preview?.source === 'github' ? 'GitHub website' : preview?.source === 'package' ? 'package homepage' : preview?.source === 'repository' ? 'repository' : 'configured URL'
  const provenance = preview && <><span className="status-dot" />{previewLabel} from {sourceLabel}<span>{preview.source === 'repository' ? preview.assetPath : preview.url}</span></>
  return <>
    <div className="dev-section">
      <div className="dev-section-heading"><span><Terminal size={16} />Development server</span><span className={`dev-state ${project.dev?.status === 'running' ? 'is-running' : ''}`}><span className="status-dot" />{project.dev?.status ?? 'stopped'}</span></div>
      {script ? <>
        <code className="dev-command">{project.packageManager} run {script.name}<span>{script.command}</span></code>
        <p className="field-hint">Uses the project’s installed dependencies and discovers its local server URL.</p>
        <div className="dev-actions">
          <Button size="sm" disabled={!!busy} onClick={() => onAction(running ? 'stop' : 'start')}>{busy.endsWith(':start') || busy.endsWith(':stop') ? <LoaderCircle className="spinning" size={14} /> : running ? <Square size={12} /> : <Play size={13} />}{running ? 'Stop server' : 'Start server'}</Button>
          {project.dev?.url && project.dev.status === 'running' && <Button variant="ghost" size="sm" asChild><a href={project.dev.url} target="_blank" rel="noreferrer">Open app<ArrowUpRight size={14} /></a></Button>}
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => onAction('logs')}>Logs</Button>
        </div>
      </> : <p className="field-hint">No dev, start, or serve script found. You can still use the project’s website or image assets below.</p>}
      {project.dev?.error && <p className="inline-error">{project.dev.error}</p>}
      {logs !== undefined && <pre className="server-logs">{logs}</pre>}
    </div>
    <ProjectScripts project={project} primaryScript={script?.name} busy={busy} onAction={onAction} />
    <div className="preview-section">
      <div className="dev-section-heading"><span><Monitor size={16} />Preview image</span></div>
      <div className="preview-source-controls">
        <label htmlFor={`preview-source-${project.id}`}>Capture from</label>
        <select id={`preview-source-${project.id}`} value={source} disabled={!!busy} onChange={event => setSource(event.target.value as PreviewMode)}>
          <option value="auto">Automatic</option>
          <option value="local">Local project</option>
          <option value="website">Project URL</option>
        </select>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => onAction('screenshot', { source })}>{busy.endsWith(':screenshot') ? <LoaderCircle className="spinning" size={14} /> : <Monitor size={14} />}{busy.endsWith(':screenshot') ? 'Capturing…' : 'Capture preview'}</Button>
      </div>
      <p className="field-hint capture-hint">{source === 'local' ? 'Tries the local app, then image assets in its repository. A server started for capture stops afterward.' : source === 'website' ? 'Uses the configured preview URL, package homepage, or the website in your GitHub repository’s About section.' : project.previewUrl ? 'Tries the configured preview URL first, then the local app and project website.' : 'Tries the local app first, then the package homepage or the website configured on GitHub. Blank pages are retried before falling back.'}</p>
      <p className="field-hint capture-hint">If screenshots fail, looks for an Open Graph image, then a logo or favicon.</p>
      {projectUrl && <a className="preview-source-link" href={projectUrl} target="_blank" rel="noreferrer">Project URL <span>{projectUrl}</span><ArrowUpRight size={13} /></a>}
      {preview && (preview.source !== 'repository' && preview.url ? <a className="preview-source-link captured-source" href={preview.url} target="_blank" rel="noreferrer">{provenance}<ArrowUpRight size={13} /></a> : <div className="preview-source-link captured-source">{provenance}</div>)}
    </div>
    {!helper && <div className="local-action-note"><HardDrive size={15} /><span>{demo ? 'Connect your directory to capture previews and use local actions.' : 'Connect this folder by its local path to capture previews and use local actions.'}</span></div>}
  </>
}
