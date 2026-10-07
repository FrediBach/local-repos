// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RepoProject } from '../types'
import { ProjectStoragePanel } from './project-storage'

afterEach(cleanup)
const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: 'group/fixture', description: '', stack: [], scripts: {}, packageManager: 'pnpm', scannedAt: '2026-10-07T12:00:00Z',
  storage: { totalBytes: 2 * 1024 ** 3, nodeModulesBytes: 500 * 1024 ** 2, hasNodeModules: true, partial: false, measuredAt: '2026-10-07T12:00:00Z' },
}
const props = { project, helper: true, demo: false, busy: '', onAction: vi.fn() }

describe('project disk usage controls', () => {
  it('measures only on request and shows total and node_modules sizes', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { rerender } = render(<ProjectStoragePanel {...props} project={{ ...project, storage: undefined }} onAction={onAction} />)
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Delete node_modules' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Measure disk usage' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('storage')
    rerender(<ProjectStoragePanel {...props} onAction={onAction} />)
    expect(screen.getByText('2.0 GiB')).toBeTruthy()
    expect(screen.getByText('500.0 MiB')).toBeTruthy()
    expect(screen.getByText(/Symlinks are not followed/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms the exact directory and reinstall command, supports cancellation, and sends explicit confirmation', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ProjectStoragePanel {...props} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Delete node_modules' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete node_modules?' })
    expect(within(dialog).getByText('group/fixture/node_modules')).toBeTruthy()
    expect(within(dialog).getByText(/Source files and lockfiles are kept/)).toBeTruthy()
    expect(within(dialog).getByText(/pnpm install/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete node_modules' }))
    dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete node_modules' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('delete-node-modules', { confirm: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['running', 'starting'] as const)('prevents deletion while the development server is %s', async (status) => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ProjectStoragePanel {...props} project={{ ...project, dev: { status } }} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Delete node_modules' }))
    expect(screen.getByText('Stop the development server before deleting dependencies.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('guards an already-open confirmation when a server starts or other work begins', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { rerender } = render(<ProjectStoragePanel {...props} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Delete node_modules' }))
    rerender(<ProjectStoragePanel {...props} project={{ ...project, dev: { status: 'starting' } }} onAction={onAction} />)
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete node_modules' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.click(confirm)
    expect(onAction).not.toHaveBeenCalled()
    rerender(<ProjectStoragePanel {...props} busy="other:audit" onAction={onAction} />)
    expect(confirm.disabled).toBe(true)
  })

  it('marks partial measurements as lower bounds and reports an absent root node_modules', () => {
    render(<ProjectStoragePanel {...props} project={{ ...project, storage: { ...project.storage!, partial: true, nodeModulesBytes: 0, hasNodeModules: false } }} />)
    expect(screen.getByText('≥ 2.0 GiB')).toBeTruthy()
    expect(screen.getByText('≥ 0 B')).toBeTruthy()
    expect(screen.getByText(/Partial measurement/)).toBeTruthy()
    expect(screen.getByText('No root node_modules directory found.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Delete node_modules' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables destructive actions in browser mode and all actions in demo mode', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { rerender } = render(<ProjectStoragePanel {...props} helper={false} onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Delete node_modules' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    rerender(<ProjectStoragePanel {...props} demo onAction={onAction} />)
    expect((screen.getByRole('button', { name: 'Refresh disk usage' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete node_modules' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ProjectStoragePanel {...props} helper={false} project={{ ...project, storage: undefined }} onAction={onAction} />)
    expect(screen.getByText('Connect with the local helper to measure disk usage and remove dependencies.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Measure disk usage' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('storage')
  })

  it('disables repeated requests while measuring or deleting', () => {
    const { rerender } = render(<ProjectStoragePanel {...props} busy="fixture:storage" />)
    expect((screen.getByRole('button', { name: 'Measuring…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete node_modules' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ProjectStoragePanel {...props} busy="fixture:delete-node-modules" />)
    expect((screen.getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Refresh disk usage' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
