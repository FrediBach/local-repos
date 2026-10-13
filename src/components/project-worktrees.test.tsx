// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GitRepository, RepoProject } from '@/types'
import { ProjectWorktrees } from './project-worktrees'

afterEach(cleanup)
const main: RepoProject = { id: 'main', name: 'Atlas', dirName: 'atlas', relativePath: 'atlas', description: '', scripts: {}, stack: [], packageManager: 'npm', scannedAt: '2026-10-13T10:00:00Z', git: { branch: 'main' }, gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: 'main-tree', checkoutPath: 'atlas', projectPath: 'packages/web', role: 'main' } }
const linked: RepoProject = { ...main, id: 'linked', relativePath: 'atlas-search', git: { branch: 'feat/search' }, gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: 'linked-tree', checkoutPath: 'atlas-search', projectPath: '', role: 'linked' } }
const member: RepoProject = { ...linked, id: 'linked-web', name: '@atlas/web', relativePath: 'atlas-search/packages/web', gitContext: { state: 'verified', repositoryId: 'repo', worktreeId: 'linked-tree', checkoutPath: 'atlas-search', projectPath: 'packages/web', role: 'linked' }, dev: { status: 'running' } }
const repository: GitRepository = { id: 'repo', name: 'Atlas', checkedAt: main.scannedAt, status: 'complete', worktrees: [
  { id: 'main-tree', path: 'atlas', role: 'main', availability: 'available', branch: 'main', projectId: main.id, dirty: false },
  { id: 'linked-tree', path: 'atlas-search', role: 'linked', availability: 'available', branch: 'feat/search', projectId: linked.id, locked: true, lockReason: 'Keep for review', dirty: true },
  { id: 'outside', path: '/Volumes/other/atlas', role: 'linked', availability: 'outside', detached: true, head: 'abcdef1234' },
] }

it('opens cached inventory without commands and navigates to the identified package even when the worktree is locked', async () => {
  const onNavigate = vi.fn(), onResync = vi.fn(), onConnect = vi.fn()
  render(<ProjectWorktrees project={main} repository={repository} projects={[main, linked, member]} helper busy="" onNavigate={onNavigate} onResync={onResync} onConnect={onConnect} />)
  expect(screen.getByText('3 worktrees reported · 2 in this folder · 1 outside it')).toBeTruthy()
  expect(screen.getByText('Locked · Keep for review')).toBeTruthy()
  expect(onNavigate).not.toHaveBeenCalled()
  expect(onResync).not.toHaveBeenCalled()
  expect(screen.getByText('1 running project')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /View package: @atlas\/web · feat\/search/ }))
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(member)
  const outside = screen.getByText('/Volumes/other/atlas').closest('li')!
  expect(within(outside).queryByRole('button')).toBeNull()
  expect(within(outside).getByText('Detached HEAD · abcdef1')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Connect another folder' }))
  expect(onConnect).toHaveBeenCalledOnce()
})

it('makes missing-package fallback explicit and does not navigate ignored projects', async () => {
  const onNavigate = vi.fn()
  const { rerender } = render(<ProjectWorktrees project={main} repository={repository} projects={[main, linked]} helper busy="" onNavigate={onNavigate} />)
  expect(screen.getByText(/is not available here; open the checkout overview/)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /View checkout: Atlas · feat\/search/ }))
  expect(onNavigate).toHaveBeenLastCalledWith(linked)
  rerender(<ProjectWorktrees project={main} repository={repository} projects={[main, linked, member]} ignoredIds={new Set([linked.id, member.id])} helper busy="" onNavigate={onNavigate} />)
  expect(screen.getByText('2 projects ignored')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /View (checkout|package):/ })).toBeNull()
})

it('keeps failed or disconnected inventory distinct from known clean state', () => {
  const { rerender } = render(<ProjectWorktrees project={main} repository={{ ...repository, status: 'unavailable', error: 'Git timed out.' }} projects={[main, linked]} helper busy="" />)
  expect(screen.getByText(/Could not refresh worktrees/)).toBeTruthy()
  expect(screen.queryByText('Clean working tree')).toBeNull()
  rerender(<ProjectWorktrees project={main} repository={repository} projects={[main, linked]} helper connected={false} busy="" onResync={vi.fn()} />)
  expect(screen.getByText(/Helper connection unavailable/)).toBeTruthy()
  expect(screen.queryByText('Clean working tree')).toBeNull()
  expect((screen.getByRole('button', { name: 'Sync folder' }) as HTMLButtonElement).disabled).toBe(false)
})

it('explains browser Git pointers without inventing a worktree or enabling scans', () => {
  render(<ProjectWorktrees project={{ ...main, gitContext: { state: 'unresolved' } }} projects={[main]} helper={false} busy="" onResync={vi.fn()} onConnect={vi.fn()} />)
  expect(screen.getByText(/Git relationships cannot be resolved in browser mode/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Sync folder' })).toBeNull()
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByRole('button', { name: 'Local helper guidance' })).toBeTruthy()
})
