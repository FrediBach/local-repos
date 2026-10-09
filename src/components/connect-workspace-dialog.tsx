import { ArrowRight, ArrowUpRight, Folder, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { installationUrl } from '@/lib/deployment'

interface Props {
  open: boolean; busy: string; hosted: boolean; helper: boolean; path: string; error: string
  onOpenChange: (open: boolean) => void; onPathChange: (path: string) => void; onConnect: (mode: 'browser' | 'helper') => void
}

export function ConnectWorkspaceDialog({ open, busy, hosted, helper, path, error, onOpenChange, onPathChange, onConnect }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="connect-dialog">
      <div className="dialog-symbol"><FolderOpen size={24} /></div><span className="eyebrow">A PLACE TO START</span>
      <DialogTitle>Bring your projects together.</DialogTitle>
      <DialogDescription>Connect the directory where your repositories live. Your files stay on your computer.</DialogDescription>
      <Button variant="outline" className="browse-button" disabled={!!busy || !('showDirectoryPicker' in window)} onClick={() => onConnect('browser')}><FolderOpen size={17} />Choose a local directory<ArrowUpRight size={15} /></Button>
      <p className="field-hint">{'showDirectoryPicker' in window ? 'Read-only folder access. Remembered in this browser for your next visit.' : hosted ? 'Folder picking needs desktop Chrome or Edge. You can still explore the demo here.' : 'Folder picking needs Chrome or Edge. Use the local helper below in this browser.'}</p>
      {hosted ? <div className="hosted-install-guidance">
        <h3>Want to run servers or manage packages?</h3>
        <p>Run Local Repos and its helper on your computer, then open the local address. This hosted page cannot connect to the helper.</p>
        <Button asChild variant="outline"><a href={installationUrl} target="_blank" rel="noopener noreferrer">Installation on GitHub<ArrowUpRight size={16} /></a></Button>
      </div> : <>
        <div className="or-divider"><span />FOR DEV SERVERS & LOCAL ACTIONS<span /></div>
        <label className="input-label" htmlFor="directory-path">Connect with the local helper <span className={`helper-status ${helper ? 'connected' : ''}`}><span className="status-dot" />{helper ? 'Available' : 'Not connected'}</span></label>
        <form onSubmit={event => { event.preventDefault(); void onConnect('helper') }}>
          <div className="path-input"><Folder size={16} /><input id="directory-path" placeholder="/Users/you/Projects" value={path} onChange={event => onPathChange(event.target.value)} autoComplete="off" spellCheck={false} /></div>
          <p className="field-hint">Enter an absolute path. The helper enables previews, dev servers, disk cleanup, package scans, and editor shortcuts.</p>
          {!helper && <p className="helper-instruction">Start the app and helper together with <code>npm run dev</code>.</p>}
          <Button className="connect-submit" disabled={!!busy || !path.trim()} type="submit">{busy === 'connect' ? <><LoaderCircle size={16} className="spinning" />Reading your projects…</> : <>Connect directory<ArrowRight size={16} /></>}</Button>
        </form>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="dialog-privacy"><ShieldCheck size={14} />{hosted ? 'Read-only access. Your workspace stays in this browser.' : 'Local workspace. Package scans contact your package registry.'}</div>
    </DialogContent></Dialog>
}
