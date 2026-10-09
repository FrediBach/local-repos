import { Check, CircleHelp, X } from 'lucide-react'

interface Props {
  notice?: { text: string; error?: boolean }
  onDismiss: () => void
}

export function WorkspaceNotice({ notice, onDismiss }: Props) {
  if (!notice) return null
  return <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button></div>
}
