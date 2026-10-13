// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectBranch } from './project-branch'
import type { RepoProject } from '@/types'

afterEach(cleanup)

const project = { scannedAt: '2026-10-13T10:00:00Z', git: { branch: 'main', recentCommits: [
  { hash: 'abcdef1234', message: 'Latest change', committedAt: '2026-10-13T09:00:00Z' },
  { hash: '1234567890', message: 'Earlier change', committedAt: '2026-10-12T09:00:00Z' },
] } } as RepoProject

it('shows branch commits on focus and dismisses with Escape', async () => {
  const user = userEvent.setup()
  render(<ProjectBranch project={project} />)
  await user.tab()
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip.textContent).toContain('main')
  expect(tooltip.textContent).toContain('Latest change')
  expect(tooltip.textContent).toContain('Earlier change')
  expect(tooltip.textContent).toContain('abcdef1')
  expect(tooltip.textContent).toContain('Last scan')
  const trigger = document.activeElement
  expect(trigger?.getAttribute('aria-describedby')).toBe(tooltip.id)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  expect(document.activeElement).toBe(trigger)
})

it('shows available legacy metadata on hover without implying full history', async () => {
  const user = userEvent.setup()
  render(<ProjectBranch project={{ ...project, git: { branch: 'main', commit: 'abcdef1234', message: 'Cached commit' } }} />)
  await user.hover(screen.getByText('main'))
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip.textContent).toContain('Cached commit')
  expect(tooltip.textContent).toContain('Recent history unavailable')
})

it('does not add a focus target for projects without Git', () => {
  render(<ProjectBranch project={{ ...project, git: undefined }} />)
  expect(screen.getByText('No Git branch').parentElement?.hasAttribute('tabindex')).toBe(false)
})
