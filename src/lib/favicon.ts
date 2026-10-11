import brandIcon from '../../public/favicon.svg?raw'

export type FaviconIndicatorKind = 'security' | 'warning' | 'activity'

const badges: Record<FaviconIndicatorKind, string> = {
  security: '<circle cx="47" cy="17" r="15" fill="#b91c1c" stroke="#f5f4ef" stroke-width="3"/><path d="M47 9v9" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="47" cy="24" r="2.5" fill="#fff"/>',
  warning: '<circle cx="50" cy="14" r="12" fill="#b45309" stroke="#f5f4ef" stroke-width="3"/>',
  activity: '<circle cx="50" cy="14" r="12" fill="#2563eb" stroke="#f5f4ef" stroke-width="3"/>',
}

const labels: Record<FaviconIndicatorKind, string> = {
  security: 'New high or critical vulnerabilities',
  warning: 'New vulnerabilities',
  activity: 'New repository activity',
}

const icons = Object.fromEntries(Object.entries(badges).map(([kind, badge]) => [
  kind,
  `data:image/svg+xml,${encodeURIComponent(brandIcon.replace('</svg>', `${badge}</svg>`))}`,
])) as Record<FaviconIndicatorKind, string>

const changedAttributes = ['href', 'type', 'sizes'] as const

/** Owns temporary tab decoration only; callers decide when updates are unread. */
export function createFaviconIndicator() {
  const originalTitle = document.title
  const originalTitleElement = document.querySelector('title')
  const originalTitleText = originalTitleElement?.textContent ?? ''
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i]')).map(link => ({
    link,
    attributes: changedAttributes.map(name => [name, link.getAttribute(name)] as const),
  }))
  let ownedLink: HTMLLinkElement | undefined
  let ownedTitle: HTMLTitleElement | undefined
  let active = false
  let disposed = false

  function clear() {
    if (!active) return
    for (const { link, attributes } of links) {
      for (const [name, value] of attributes) {
        if (value === null) link.removeAttribute(name)
        else link.setAttribute(name, value)
      }
    }
    ownedLink?.remove()
    ownedLink = undefined
    if (originalTitleElement) originalTitleElement.textContent = originalTitleText
    ownedTitle?.remove()
    ownedTitle = undefined
    active = false
  }

  return {
    update(kind: FaviconIndicatorKind | undefined, summary?: string) {
      if (disposed) return
      if (!kind) {
        clear()
        return
      }
      if (links.length === 0 && !ownedLink) {
        ownedLink = document.createElement('link')
        ownedLink.rel = 'icon'
        document.head.append(ownedLink)
      }
      const targets = ownedLink ? [ownedLink] : links.map(({ link }) => link)
      for (const link of targets) {
        link.setAttribute('href', icons[kind])
        link.setAttribute('type', 'image/svg+xml')
        link.setAttribute('sizes', 'any')
      }
      const prefix = summary?.trim() || labels[kind]
      document.title = originalTitle ? `${prefix} — ${originalTitle}` : prefix
      if (!originalTitleElement) ownedTitle = document.querySelector('title') ?? undefined
      active = true
    },
    dispose() {
      clear()
      disposed = true
    },
  }
}
