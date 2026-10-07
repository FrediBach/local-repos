import { useRef, useState } from 'react'
import { ArrowUpRight, Globe, Monitor, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { installationUrl } from '@/lib/deployment'
import './hosted-notice.css'

const dismissalKey = 'local-repos:hosted-notice:v1'

export function HostedNotice() {
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(dismissalKey) !== 'dismissed' } catch { return true }
  })
  const titleRef = useRef<HTMLHeadingElement>(null)

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      try { sessionStorage.setItem(dismissalKey, 'dismissed') } catch { /* Still dismissible when storage is blocked. */ }
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Globe size={15} aria-hidden="true" />Hosted version</Button></DialogTrigger>
    <DialogContent className="hosted-dialog" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus() }}>
      <span className="eyebrow">LOCAL REPOS ON THE WEB</span>
      <DialogTitle ref={titleRef} tabIndex={-1}>Your projects, from the browser.</DialogTitle>
      <DialogDescription>This version runs on Vercel. You can explore and organize your projects here; some actions need Local Repos running on your computer.</DialogDescription>
      <div className="hosted-capabilities">
        <section aria-labelledby="hosted-browser-features">
          <h3 id="hosted-browser-features"><Monitor size={18} aria-hidden="true" />Available here</h3>
          <ul>
            <li>Explore the demo, or choose a local folder in desktop Chrome or Edge.</li>
            <li>Browse READMEs, packages, and basic Git details. Search, filter, and save favorites.</li>
            <li>Install the web app and revisit your cached workspace offline.</li>
          </ul>
        </section>
        <section aria-labelledby="hosted-local-features">
          <h3 id="hosted-local-features"><Terminal size={18} aria-hidden="true" />Run locally for</h3>
          <ul>
            <li>Development servers, preview capture, and editor or file-browser shortcuts.</li>
            <li>Vulnerability scans, outdated-package checks, and package updates.</li>
            <li>Disk usage measurements and dependency cleanup.</li>
          </ul>
        </section>
      </div>
      <p className="hosted-local-note">For these local actions, run the app and its helper on your computer, then open the local address. Installing this web app alone does not enable them.</p>
      <div className="hosted-dialog-actions">
        <Button asChild><a href={installationUrl} target="_blank" rel="noopener noreferrer">Installation on GitHub<ArrowUpRight size={16} aria-hidden="true" /></a></Button>
        <Button variant="outline" onClick={() => changeOpen(false)}>Continue browsing</Button>
      </div>
      <p className="hosted-privacy">Folder access here is read-only. Your workspace is saved in this browser.</p>
    </DialogContent>
  </Dialog>
}
