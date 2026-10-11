// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectActionMenu } from './project-action-menu'
import type { RepoProject } from '@/types'

afterEach(cleanup)
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: ['React'], packageManager: 'npm', hasPackageJson: true, scannedAt: '', scripts: { dev: 'vite' } }
const scans = [
  ['Scan for vulnerabilities', 'audit'], ['Check outdated packages', 'outdated'],
  ['Scan unused packages', 'unused'], ['Run React Doctor', 'react-doctor'], ['Measure disk usage', 'storage'],
  ['Run Lighthouse', 'lighthouse'],
]
function setup(value = project, busy = '') {
  const onAction = vi.fn()
  const user = userEvent.setup()
  render(<ProjectActionMenu project={value} busy={busy} favorite={false} tagsReady onOpen={vi.fn()} onEditTags={vi.fn()} onToggleFavorite={vi.fn()} onAction={onAction} />)
  return { user, onAction }
}

describe('project action menu', () => {
  it('opens scripts with the keyboard and launches the selected script in its project', async () => {
    const value = { ...project, scripts: { dev: 'vite', 'test:watch': 'vitest', utility: 'node utility.js', prepare: 'husky', pretest: 'echo setup', test: 'vitest run' } }
    const { user, onAction } = setup(value)
    const trigger = screen.getByRole('button', { name: 'Actions for Fixture' })
    await user.click(trigger)
    screen.getByRole('menuitem', { name: 'Scripts', exact: true }).focus()
    await user.keyboard('{ArrowRight}')
    const script = await screen.findByRole('menuitem', { name: 'test:watch', exact: true })
    for (const name of ['dev', 'prepare', 'pretest']) expect(screen.queryByRole('menuitem', { name, exact: true })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'utility', exact: true })).toBeTruthy()
    expect(script.title).toBe('npm run test:watch: vitest')
    script.focus()
    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledExactlyOnceWith(value, 'run-script', { name: 'test:watch', command: 'vitest' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('offers scripts without a dev server and disables the submenu while busy', async () => {
    const { user, onAction } = setup({ ...project, scripts: { test: 'vitest run' } }, 'other:audit')
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    const submenu = screen.getByRole('menuitem', { name: 'Scripts', exact: true })
    expect(submenu.getAttribute('data-disabled')).not.toBeNull()
    await user.click(submenu)
    expect(screen.queryByRole('menuitem', { name: 'test', exact: true })).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('omits the scripts submenu when only the primary server is available', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    expect(screen.queryByRole('menuitem', { name: 'Scripts', exact: true })).toBeNull()
  })

  it.each(scans)('reruns %s for the selected project and restores focus', async (label, action) => {
    const { user, onAction } = setup()
    const trigger = screen.getByRole('button', { name: 'Actions for Fixture' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: label }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(project, action, undefined)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it.each([['Automatic', 'auto'], ['Local project', 'local'], ['Project URL', 'website']])('captures the %s preview using keyboard navigation', async (label, source) => {
    const { user, onAction } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    screen.getByRole('menuitem', { name: 'Capture preview' }).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitem', { name: label, exact: true }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(project, 'screenshot', { source })
  })

  it('only offers applicable package, React, and development actions', async () => {
    const { user } = setup({ ...project, hasPackageJson: false, stack: [], scripts: {} })
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    for (const [label] of scans.slice(0, 4)) expect(screen.queryByRole('menuitem', { name: label })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Run Lighthouse' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Start development server' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Measure disk usage' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Capture preview' })).toBeTruthy()
  })

  it('disables helper operations while busy but keeps project navigation available', async () => {
    const { user, onAction } = setup(project, 'other:audit')
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    for (const label of [...scans.map(([label]) => label), 'Capture preview', 'Start development server']) {
      expect(screen.getByRole('menuitem', { name: label }).getAttribute('data-disabled')).not.toBeNull()
    }
    expect(screen.getByRole('menuitem', { name: 'Project details' }).getAttribute('data-disabled')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('offers stop instead of start for a running development server', async () => {
    const running = { ...project, dev: { status: 'running' as const } }
    const { user, onAction } = setup(running)
    await user.click(screen.getByRole('button', { name: 'Actions for Fixture' }))
    expect(screen.queryByRole('menuitem', { name: 'Start development server' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Stop development server' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(running, 'stop')
  })
})
