// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProjectRemoteActivity } from './project-remote-activity'
import type { RepoProject } from '../types'

afterEach(cleanup)
const project: RepoProject = { id: 'one', name: 'One', dirName: 'one', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '', git: { origin: 'https://gitlab.com/team/repo' } }
it('shows accessible dated counts, including zero, with provider-specific links', () => {
  render(<ProjectRemoteActivity project={{ ...project, remoteActivity: { repository: project.git!.origin!, scannedAt: '2026-10-10T10:00:00Z', issues: [], pullRequests: [2, 3] } }} />)
  expect(screen.getByRole('link', { name: /0 open issues/ }).getAttribute('href')).toBe('https://gitlab.com/team/repo/-/issues')
  expect(screen.getByRole('link', { name: /2 open merge requests/ }).getAttribute('href')).toBe('https://gitlab.com/team/repo/-/merge_requests')
  expect(screen.getByRole('link', { name: /0 open issues/ }).getAttribute('title')).toContain('Last successful check')
})
it('never presents missing or mismatched reports as zero', () => {
  const { rerender } = render(<ProjectRemoteActivity project={project} />)
  expect(screen.queryAllByRole('link')).toHaveLength(0)
  rerender(<ProjectRemoteActivity project={{ ...project, remoteActivity: { repository: 'https://github.com/team/other', scannedAt: '', issues: [], pullRequests: [] } }} />)
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})
