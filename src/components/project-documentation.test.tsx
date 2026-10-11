// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectDocumentation } from './project-documentation'
import type { RepoProject } from '@/types'

afterEach(cleanup)
const project: RepoProject = {
  id: 'docs', name: 'docs', dirName: 'docs', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '',
  readme: '# Welcome\n\nThe **first** paragraph.\n\n## Installation\n\nThe rest of the README.',
}

it('shows the title and first paragraph, with keyboard disclosure and collapse', async () => {
  const user = userEvent.setup()
  render(<ProjectDocumentation project={project} />)
  expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy()
  expect(screen.getByText('first', { selector: 'strong' })).toBeTruthy()
  expect(screen.queryByText('The rest of the README.')).toBeNull()
  expect(screen.queryByRole('button', { name: /Choose documentation/ })).toBeNull()
  const toggle = screen.getByRole('button', { name: 'Read more' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('heading', { name: 'Installation' })).toBeTruthy()
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  await user.keyboard(' ')
  expect(screen.queryByText('The rest of the README.')).toBeNull()
  expect(document.activeElement).toBe(toggle)
})

it('lists nested folders with README first and opens selected documents', async () => {
  const user = userEvent.setup()
  render(<ProjectDocumentation project={{ ...project, documentation: { files: [
    { path: 'docs/setup/install.md', content: '# Install\n\nUse npm.\n\n## Next steps\n\nStart the app.' },
    { path: 'doc/reference.markdown', content: '# Reference' },
    { path: 'documentation/empty.mdx', content: '' },
  ], warnings: [] } }} />)
  const picker = screen.getByRole('button', { name: 'Choose documentation file: README' })
  await user.click(picker)
  expect(screen.getAllByRole('menuitem')[0].textContent).toBe('README')
  expect(screen.getByRole('group', { name: 'docs/setup' })).toBeTruthy()
  await user.click(screen.getByRole('menuitem', { name: 'docs/setup/install.md' }))
  expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Welcome' })).toBeNull()
  expect(document.activeElement).toBe(picker)
  await user.click(picker)
  await user.click(screen.getByRole('menuitem', { name: 'README' }))
  expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy()
  await user.click(picker)
  await user.click(screen.getByRole('menuitem', { name: 'documentation/empty.mdx' }))
  expect(screen.getByText('This document is empty.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull()
  await user.click(picker)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(picker)
})

it('keeps missing README, unavailable documents, and scan limits explicit', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<ProjectDocumentation project={{ ...project, readme: undefined }} />)
  expect(screen.getByText('No README found in this project.')).toBeTruthy()
  rerender(<ProjectDocumentation project={{ ...project, readme: undefined, documentation: { files: [{ path: 'docs/large.md', unavailable: 'Too large to cache.' }], warnings: ['Some files were skipped.'] } }} />)
  await user.click(screen.getByRole('button', { name: /Choose documentation/ }))
  await user.click(screen.getByRole('menuitem', { name: 'docs/large.md' }))
  expect(screen.getByText('Too large to cache.')).toBeTruthy()
  expect(screen.getByText('Some files were skipped.')).toBeTruthy()
  expect(screen.queryByText('No README found in this project.')).toBeNull()
})
