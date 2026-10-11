import { useState } from 'react'
import { useMermaid } from '@/hooks/use-mermaid'

export function MermaidDiagram({ source }: { source: string }) {
  const result = useMermaid(source)
  const [failedUrl, setFailedUrl] = useState<string>()
  const image = result?.image?.url !== failedUrl ? result?.image : undefined
  const code = <pre><code className="language-mermaid">{source}</code></pre>

  return <figure className="mermaid-diagram" aria-label="Mermaid diagram">
    {image ? <>
      <div className="mermaid-image"><img src={image.url} alt={image.title} onError={() => setFailedUrl(image.url)} /></div>
      <details className="mermaid-source"><summary>Diagram source</summary>{code}</details>
    </> : <>
      <p className="mermaid-status" role="status">{result?.error ?? (result?.image ? 'This diagram image could not be displayed. Its source is shown below.' : 'Rendering diagram…')}</p>
      {code}
    </>}
  </figure>
}
