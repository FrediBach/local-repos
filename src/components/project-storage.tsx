import { useState } from 'react'
import { HardDrive, LoaderCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { RepoProject } from '@/types'
import { formatBytes } from '@/lib/format-bytes'

export function ProjectStoragePanel({ project, helper, demo, busy, onAction }: {
  project: RepoProject; helper: boolean; demo: boolean; busy: string; onAction: (name: string, body?: unknown) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const storage = project.storage
  const measuring = busy === `${project.id}:storage`
  const deleting = busy === `${project.id}:delete-node-modules`
  const running = project.dev?.status === 'running' || project.dev?.status === 'starting'
  return <section className="storage-section" aria-label="Project disk usage">
    <div className="maintenance-heading"><h3><HardDrive size={16} /> Disk usage</h3><Button variant="outline" size="sm" disabled={!!busy || demo} onClick={() => onAction('storage')}>
      {measuring ? <LoaderCircle size={14} className="spinning" /> : <HardDrive size={14} />}{measuring ? 'Measuring…' : storage ? 'Refresh disk usage' : 'Measure disk usage'}
    </Button></div>
    {storage ? <>
      <div className="storage-stats"><div><span>Entire project</span><strong>{storage.partial && '≥ '}{formatBytes(storage.totalBytes)}</strong></div><div><span>Root node_modules</span><strong>{storage.partial && '≥ '}{formatBytes(storage.nodeModulesBytes)}</strong></div></div>
      <p className="maintenance-hint">{storage.partial ? 'Partial measurement: some entries could not be counted. Sizes shown are lower bounds. ' : 'Includes dependencies, build output, and Git files. Symlinks are not followed. '}Measured {new Date(storage.measuredAt).toLocaleString()}.</p>
      <Button variant="outline" size="sm" className="danger-button" disabled={!!busy || !storage.hasNodeModules || running || !helper || demo} onClick={() => setConfirm(true)}>{deleting ? <LoaderCircle size={14} className="spinning" /> : <Trash2 size={14} />}{deleting ? 'Deleting…' : 'Delete node_modules'}</Button>
      {running && <p className="maintenance-hint">Stop the development server before deleting dependencies.</p>}
      {!storage.hasNodeModules && <p className="maintenance-hint">No root node_modules directory found.</p>}
    </> : <p className="maintenance-hint">{demo ? 'Connect a directory to measure project storage.' : helper ? 'Measure this project’s files and its root node_modules directory.' : 'Connect with the local helper to measure disk usage and remove dependencies.'}</p>}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent className="delete-dialog"><DialogTitle>Delete node_modules?</DialogTitle><DialogDescription>This permanently removes the root node_modules directory in {project.name}. Source files and lockfiles are kept. Reinstall dependencies with {project.packageManager} install before running this project again.</DialogDescription><code className="delete-path">{project.relativePath === '.' ? project.dirName : project.relativePath}/node_modules</code><div className="delete-actions"><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button className="danger-button" disabled={!!busy || running} onClick={() => { setConfirm(false); onAction('delete-node-modules', { confirm: true }) }}><Trash2 size={14} />Delete node_modules</Button></div></DialogContent></Dialog>
  </section>
}
