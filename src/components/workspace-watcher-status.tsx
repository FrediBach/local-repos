import { RefreshCw } from 'lucide-react'
import type { useWorkspaceWatcher } from '@/hooks/use-workspace-watcher'
import type { AppSettings } from '@/lib/settings'

interface Props {
  watcher: ReturnType<typeof useWorkspaceWatcher>
  mode: AppSettings['watcherMode']
  scanning: boolean
}

export function WorkspaceWatcherStatus({ watcher, mode, scanning }: Props) {
  return <div className={`watcher-status ${watcher.error ? 'watcher-error' : ''}`} role="region" aria-label="Workspace watcher" aria-live="polite" title={watcher.nextRun ? `Next ${mode === 'changes' ? 'change check' : 'scan'}: ${new Date(watcher.nextRun).toLocaleTimeString()}. Configure in Settings → Watcher.` : 'Configure in Settings → Watcher.'}><RefreshCw size={13} className={scanning ? 'spinning' : ''} /><span>{watcher.message}</span>{scanning && <span>Change to manual mode in Settings to stop after the current check.</span>}</div>
}
