import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Clock3 } from 'lucide-react'
import { scanRelativeTime } from '@/lib/scan-relative-time'
import './scan-badge-tooltip.css'

interface Props {
  children: ReactElement
  heading: string
  details: ReactNode
  scannedAt: string
  dateLabel?: string
}

export function ScanBadgeTooltip({ children, heading, details, scannedAt, dateLabel = 'Last scan' }: Props) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [open])
  const validDate = Number.isFinite(Date.parse(scannedAt))
  return <Tooltip.Provider delayDuration={250}>
    <Tooltip.Root open={open} onOpenChange={value => { setNow(Date.now()); setOpen(value) }}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="scan-badge-tooltip" side="top" sideOffset={8} collisionPadding={12}>
          <strong className="scan-badge-tooltip-heading">{heading}</strong>
          <div className="scan-badge-tooltip-details">{details}</div>
          <div className="scan-badge-tooltip-date"><Clock3 size={13} aria-hidden="true" /><span>{dateLabel}<time dateTime={validDate ? scannedAt : undefined}>{scanRelativeTime(scannedAt, now)}</time></span></div>
          <Tooltip.Arrow className="scan-badge-tooltip-arrow" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
}
