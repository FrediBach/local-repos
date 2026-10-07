import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './project-readme.css'

export function ProjectReadme({ content }: { content?: string }) {
  return <div className="readme-content">
    {content?.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
      table: ({ node: _node, ...props }) => <div className="readme-table-scroll" role="region" aria-label="README table" tabIndex={0}><table {...props} /></div>,
    }}>{content}</Markdown> : <p>No README found in this project.</p>}
  </div>
}
