import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkReadmePreview } from '@/lib/readme-preview'
import './project-readme.css'

export function ProjectReadme({ content, preview = false, emptyMessage = 'No README found in this project.' }: { content?: string; preview?: boolean; emptyMessage?: string }) {
  return <div className="readme-content">
    {content?.trim() ? <Markdown remarkPlugins={preview ? [remarkGfm, remarkReadmePreview] : [remarkGfm]} skipHtml components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
      table: ({ node: _node, ...props }) => <div className="readme-table-scroll" role="region" aria-label="README table" tabIndex={0}><table {...props} /></div>,
    }}>{content}</Markdown> : <p>{emptyMessage}</p>}
  </div>
}
