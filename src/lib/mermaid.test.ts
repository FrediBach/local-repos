// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import { renderMermaid } from './mermaid'

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }))
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><title>Build pipeline</title><text>Build</text></svg>'
beforeEach(() => {
  vi.mocked(mermaid.render).mockResolvedValue({ svg, diagramType: 'flowchart' })
})
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })

it('renders with locked security settings, image dimensions, and an accessible title', async () => {
  const result = await renderMermaid('flowchart LR\nA --> B', 'dark', new AbortController().signal)
  expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
    securityLevel: 'strict', startOnLoad: false, htmlLabels: false, theme: 'dark', suppressErrorRendering: true,
    secure: expect.arrayContaining(['securityLevel', 'maxEdges', 'themeCSS', 'htmlLabels', 'dompurifyConfig']),
  }))
  expect(result.title).toBe('Build pipeline')
  expect(result.svg).toContain('width="240"')
  expect(result.svg).toContain('height="80"')
  expect(document.body.childElementCount).toBe(0)
})

it('serializes themes, cleans up failed renders, and keeps the queue usable', async () => {
  let fail!: (error: Error) => void
  vi.mocked(mermaid.render).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const first = renderMermaid('broken', 'dark', new AbortController().signal)
  const failed = expect(first).rejects.toThrow('Broken diagram')
  const second = renderMermaid('flowchart LR\nA --> B', 'light', new AbortController().signal)
  await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1))
  expect(mermaid.initialize).toHaveBeenCalledTimes(1)
  expect(document.body.childElementCount).toBe(1)
  fail(new Error('Broken diagram'))
  await failed
  await second
  expect(vi.mocked(mermaid.initialize).mock.calls.map(([config]) => config?.theme)).toEqual(['dark', 'neutral'])
  expect(vi.mocked(mermaid.render).mock.calls[0][0]).not.toBe(vi.mocked(mermaid.render).mock.calls[1][0])
  expect(document.body.childElementCount).toBe(0)
})

it('skips cancelled and oversized work before calling Mermaid', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(renderMermaid('flowchart LR\nA --> B', 'light', controller.signal)).rejects.toThrow()
  await expect(renderMermaid('x'.repeat(50_001), 'light', new AbortController().signal)).rejects.toThrow('too large')
  expect(mermaid.render).not.toHaveBeenCalled()
  expect(document.body.childElementCount).toBe(0)
})
