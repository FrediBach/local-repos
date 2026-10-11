import { useEffect, useState, useSyncExternalStore } from 'react'
import { renderMermaid, type DiagramTheme } from '@/lib/mermaid'

function readTheme(): DiagramTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

interface DiagramResult {
  source: string
  theme: DiagramTheme
  image?: { url: string; title: string }
  error?: string
}

export function useMermaid(source: string) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as const)
  const [result, setResult] = useState<DiagramResult>()

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    void renderMermaid(source, theme, controller.signal).then(image => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml' }))
      setResult({ source, theme, image: { url, title: image.title } })
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ source, theme, error: 'This Mermaid diagram could not be rendered. Its source is shown below.' })
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, theme])

  return result?.source === source && result.theme === theme ? result : undefined
}
