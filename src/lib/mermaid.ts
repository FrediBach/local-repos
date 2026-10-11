export type DiagramTheme = 'light' | 'dark'

export interface MermaidImage {
  svg: string
  title: string
}

let renderQueue: Promise<unknown> = Promise.resolve()
let nextDiagram = 0
const MAX_DIAGRAM_LENGTH = 50_000

/** Mermaid has global configuration; keep initialization and rendering together. */
export function renderMermaid(source: string, theme: DiagramTheme, signal: AbortSignal): Promise<MermaidImage> {
  const result = renderQueue.then(async () => {
    signal.throwIfAborted()
    if (source.length > MAX_DIAGRAM_LENGTH) throw new Error('This diagram is too large to render. Its source is shown below.')
    const { default: mermaid } = await import('mermaid')
    signal.throwIfAborted()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: MAX_DIAGRAM_LENGTH,
      maxEdges: 500,
      theme: theme === 'dark' ? 'dark' : 'neutral',
      fontFamily: 'Arial, sans-serif',
      htmlLabels: false,
      themeCSS: '* { animation: none !important; transition: none !important; }',
      // Repository directives must not weaken these settings or inject CSS.
      secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'dompurifyConfig'],
    })
    const container = document.createElement('div')
    container.setAttribute('aria-hidden', 'true')
    container.style.cssText = 'position: fixed; left: -100000px; top: 0; visibility: hidden; pointer-events: none;'
    document.body.append(container)
    try {
      const { svg } = await mermaid.render(`readme-mermaid-${++nextDiagram}`, source, container)
      signal.throwIfAborted()
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
      if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Invalid diagram image')
      const element = parsed.documentElement
      // Explicit dimensions preserve the aspect ratio when SVG is used as an image.
      const viewBox = element.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
      if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        element.setAttribute('width', String(viewBox[2]))
        element.setAttribute('height', String(viewBox[3]))
      }
      return { svg: new XMLSerializer().serializeToString(element), title: parsed.querySelector('title')?.textContent?.trim() || 'Mermaid diagram' }
    } finally {
      container.remove()
    }
  })
  // A failed or cancelled diagram must not prevent subsequent diagrams rendering.
  renderQueue = result.catch(() => undefined)
  return result
}
