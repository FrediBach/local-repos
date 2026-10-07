// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProjectReadme } from './project-readme'

afterEach(cleanup)

it('renders Markdown and GitHub-flavored content as semantic elements', () => {
  const { container } = render(<ProjectReadme content={'# Setup\n\nRead **carefully** and use `npm install`.\n\n- [x] Installed\n\n| Package | Version |\n| --- | --- |\n| react | 19 |\n\n```sh\nnpm run dev\n```\n\n[Docs](https://example.com)'} />)
  expect(screen.getByRole('heading', { name: 'Setup', level: 1 })).toBeTruthy()
  expect(container.querySelector('strong')?.textContent).toBe('carefully')
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  expect(screen.getByRole('table')).toBeTruthy()
  expect(container.querySelector('pre code')?.textContent).toBe('npm run dev\n')
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('rel')).toContain('noopener')
})

it('does not render embedded HTML or unsafe link URLs', () => {
  const { container } = render(<ProjectReadme content={'<style>body { display: none; }</style>\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)'} />)
  expect(container.querySelector('style, script')).toBeNull()
  expect(container.querySelector('a')?.getAttribute('href')).toBe('')
})

it('shows a helpful empty state', () => {
  render(<ProjectReadme content="  " />)
  expect(screen.getByText('No README found in this project.')).toBeTruthy()
})
