import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkReadmePreview } from '@/lib/readme-preview'
import { MermaidDiagram } from './mermaid-diagram'
import './project-readme.css'

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _node, ...props }) => <div className="readme-table-scroll" role="region" aria-label="README table" tabIndex={0}><table {...props} /></div>,
  pre: ({ node, ...props }) => {
    const code = node?.children[0]
    if (node?.children.length === 1 && code?.type === 'element' && code.tagName === 'code'
      && Array.isArray(code.properties.className) && code.properties.className.some(name => String(name).toLowerCase() === 'language-mermaid')) {
      const source = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
      return <MermaidDiagram source={source} />
    }
    return <pre {...props} />
  },
}

export function ProjectReadme({ content, preview = false, emptyMessage = 'No README found in this project.' }: { content?: string; preview?: boolean; emptyMessage?: string }) {
  return <div className="readme-content">
    {content?.trim() ? <Markdown remarkPlugins={preview ? [remarkGfm, remarkReadmePreview] : [remarkGfm]} skipHtml components={components}>{content}</Markdown> : <p>{emptyMessage}</p>}
  </div>
}
