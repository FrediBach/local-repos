// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProjectReadme } from './project-readme'
import { ProjectDocumentation } from './project-documentation'
import { renderMermaid, type MermaidImage } from '@/lib/mermaid'
import type { RepoProject } from '@/types'

vi.mock('@/lib/mermaid', () => ({ renderMermaid: vi.fn() }))
const source = 'flowchart LR\nA --> B'
const markdown = `# Guide\n\nA short introduction.\n\n\`\`\`mermaid\n${source}\n\`\`\``
const image: MermaidImage = { svg: '<svg xmlns="http://www.w3.org/2000/svg" />', title: 'Build pipeline' }
let nextUrl = 0
const createObjectURL = vi.fn(() => `blob:diagram-${++nextUrl}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  vi.mocked(renderMermaid).mockResolvedValue(image)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

it('renders Mermaid fences as images with a source disclosure', async () => {
  const user = userEvent.setup()
  const { container } = render(<ProjectReadme content={`${markdown}\n\n\`\`\`ts\nconst value = 1\n\`\`\`\n\nInline \`mermaid\` stays text.`} />)
  const diagram = await screen.findByRole('img', { name: 'Build pipeline' })
  expect(diagram.getAttribute('src')).toMatch(/^blob:diagram-/)
  expect(renderMermaid).toHaveBeenCalledExactlyOnceWith(source, 'light', expect.any(AbortSignal))
  expect(container.querySelector('pre > figure')).toBeNull()
  expect(container.querySelector('code.language-ts')?.textContent).toBe('const value = 1\n')
  const disclosure = screen.getByText('Diagram source')
  await user.click(disclosure)
  expect(container.querySelector('details')?.open).toBe(true)
  expect(container.querySelector('code.language-mermaid')?.textContent).toBe(source)
})

it('keeps diagrams out of collapsed introductions and renders them in selected docs', async () => {
  const user = userEvent.setup()
  const project: RepoProject = {
    id: 'docs', name: 'docs', dirName: 'docs', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '',
    readme: markdown, documentation: { files: [{ path: 'docs/architecture.md', content: markdown.replace('A --> B', 'C --> D') }], warnings: [] },
  }
  render(<ProjectDocumentation project={project} />)
  expect(renderMermaid).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Read more' }))
  await screen.findByRole('img', { name: 'Build pipeline' })
  await user.click(screen.getByRole('button', { name: /Choose documentation file/ }))
  await user.click(screen.getByRole('menuitem', { name: 'docs/architecture.md' }))
  await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith('flowchart LR\nC --> D', 'light', expect.any(AbortSignal)))
  await screen.findByRole('img', { name: 'Build pipeline' })
})

it('shows source for parser and image failures without affecting surrounding Markdown', async () => {
  vi.mocked(renderMermaid).mockRejectedValueOnce(new Error('Invalid syntax'))
  const { rerender, container } = render(<ProjectReadme content={markdown} />)
  expect(await screen.findByText(/could not be rendered/)).toBeTruthy()
  expect(container.querySelector('code.language-mermaid')?.textContent).toBe(source)
  expect(screen.getByRole('heading', { name: 'Guide' })).toBeTruthy()
  rerender(<ProjectReadme content={markdown.replace('A --> B', 'A --> C')} />)
  const diagram = await screen.findByRole('img', { name: 'Build pipeline' })
  fireEvent.error(diagram)
  expect(screen.getByText(/could not be displayed/)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

it('ignores late responses, follows theme changes, and releases images on unmount', async () => {
  let finishOld!: (image: MermaidImage) => void
  vi.mocked(renderMermaid).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  const { rerender, unmount } = render(<ProjectReadme content={markdown} />)
  rerender(<ProjectReadme content={markdown.replace('A --> B', 'B --> C')} />)
  const current = await screen.findByRole('img', { name: 'Build pipeline' })
  const firstUrl = current.getAttribute('src')
  await act(async () => { finishOld({ ...image, title: 'Stale diagram' }) })
  expect(screen.queryByRole('img', { name: 'Stale diagram' })).toBeNull()
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  await act(async () => { document.documentElement.dataset.theme = 'dark' })
  await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith('flowchart LR\nB --> C', 'dark', expect.any(AbortSignal)))
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).not.toBe(firstUrl))
  expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)
  const lastUrl = screen.getByRole('img').getAttribute('src')
  unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith(lastUrl)
})

it('handles Strict Mode remounts without publishing cancelled work', async () => {
  const { unmount } = render(<StrictMode><ProjectReadme content={markdown} /></StrictMode>)
  await screen.findByRole('img')
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  expect(vi.mocked(renderMermaid).mock.calls[0][2].aborted).toBe(true)
  unmount()
  expect(revokeObjectURL).toHaveBeenCalledTimes(1)
})
