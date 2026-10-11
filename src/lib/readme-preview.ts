interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

function hasText(node: MarkdownNode): boolean {
  if (node.type === 'html' || node.type === 'image' || node.type === 'imageReference') return false
  return !!node.value?.trim() || !!node.children?.some(hasText)
}

/** Use the Markdown parser's blocks so code, badges, and setext titles work. */
export function remarkReadmePreview() {
  return (tree: { children: MarkdownNode[] }) => {
    const title = tree.children.find(node => node.type === 'heading')
    const paragraph = tree.children.find(node => node.type === 'paragraph' && hasText(node))
    // Reference definitions must survive even when they occur after the preview.
    tree.children = [title, paragraph, ...tree.children.filter(node => node.type === 'definition')]
      .filter((node): node is MarkdownNode => !!node)
    if (!title && !paragraph) tree.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'Open this document to read its contents.' }] })
  }
}
