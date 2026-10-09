import { ShieldCheck, Unplug } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Logo } from './brand-logo'
import type { Workspace } from '@/types'

export function WorkspaceHelpDialog({ open, onOpenChange, workspace, busy, onForget }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspace?: Workspace; busy: boolean; onForget: () => void
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="help-dialog"><Logo /><DialogTitle>A little order. A lot of possibility.</DialogTitle><DialogDescription>Local Repos is a quiet home for your checked-out projects.</DialogDescription><div className="help-steps"><div><span>01</span><div><h3>Connect a directory.</h3><p>Choose your projects folder. We look for repositories and package.json files up to two folders deep, including declared monorepo workspaces and skipping dependencies and build output.</p></div></div><div><span>02</span><div><h3>Find your bearings.</h3><p>README introductions, technologies, package details, and Git history come together in one place. Favorite the projects you return to.</p></div></div><div><span>03</span><div><h3>Pick up where you left off.</h3><p>The local helper opens your editor, runs your dev script, and captures a preview. Only projects you explicitly start are run.</p></div></div></div><div className="help-cache"><ShieldCheck size={20} /><p>Your directory connection and project metadata are cached in IndexedDB. Use resync to read changes or configure automatic scans in Settings → Watcher. The production PWA keeps the interface available offline.</p></div><ScanNotes warnings={workspace?.warnings ?? []} />{workspace && <Button variant="outline" disabled={!!busy} onClick={onForget}><Unplug size={15} />Forget this directory</Button>}</DialogContent></Dialog>
}

function ScanNotes({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  // Equal messages can come from distinct folders; retain each occurrence.
  const occurrences = new Map<string, number>()
  const notes = warnings.map(message => {
    const occurrence = (occurrences.get(message) ?? 0) + 1
    occurrences.set(message, occurrence)
    return { message, key: JSON.stringify([message, occurrence]) }
  })
  return <details className="scan-warnings"><summary>{warnings.length} scan notes</summary><ul>{notes.map(note => <li key={note.key}>{note.message}</li>)}</ul></details>
}
