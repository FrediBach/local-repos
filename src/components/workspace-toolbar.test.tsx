// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { WorkspaceToolbar } from './workspace-toolbar'
import { WorkspaceReportNote } from './workspace-report-note'
import type { RepoProject, Workspace } from '@/types'

afterEach(cleanup)

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: 'fixture', description: '',
  stack: ['React'], scripts: { dev: 'vite' }, packageManager: 'npm', scannedAt: '2026-10-10T10:00:00Z',
  git: { origin: 'https://github.com/example/fixture' },
}
const workspace: Workspace = {
  mode: 'helper', rootName: 'Projects', rootPath: '/Users/ada/Projects', projects: [project], syncedAt: project.scannedAt,
}
const checks = [
  ['Check issues & PRs', 'scanAllRemoteActivity'],
  ['Scan outdated packages', 'scanAllOutdated'],
  ['Scan vulnerabilities', 'scanAllVulnerabilities'],
  ['Scan React projects', 'scanAllReactDoctor'],
  ['Scan frontends with Lighthouse', 'scanAllLighthouse'],
] as const

function callbacks() {
  return {
    onResync: vi.fn(), scanAllRemoteActivity: vi.fn(), scanAllOutdated: vi.fn(),
    scanAllVulnerabilities: vi.fn(), scanAllReactDoctor: vi.fn(), scanAllLighthouse: vi.fn(), captureAllPreviews: vi.fn(),
  }
}
const trigger = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run checks', exact: true })

describe('workspace toolbar', () => {
  it('supports keyboard discovery, selection, and Escape with focus restored to Run checks', async () => {
    const user = userEvent.setup(), actions = callbacks()
    render(<WorkspaceToolbar {...actions} workspace={workspace} projectCount={1} busy="" />)
    expect(screen.queryByRole('menu')).toBeNull()
    trigger().focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Check issues & PRs' })))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(actions.scanAllOutdated).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('menuitem')).toHaveLength(5)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
    expect(actions.scanAllOutdated).toHaveBeenCalledOnce()
  })

  it.each(checks)('dispatches %s to its existing workspace callback', async (label, callback) => {
    const user = userEvent.setup(), actions = callbacks()
    render(<WorkspaceToolbar {...actions} workspace={workspace} projectCount={1} busy="" />)
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: label, exact: true }))
    for (const [key, action] of Object.entries(actions)) expect(action).toHaveBeenCalledTimes(key === callback ? 1 : 0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps keyboard focus at the actions when starting a check disables its trigger', async () => {
    const user = userEvent.setup()
    function BusyWorkspace() {
      const [busy, setBusy] = useState('')
      return <>
        <WorkspaceToolbar {...callbacks()} workspace={workspace} projectCount={1} busy={busy} scanAllOutdated={() => setBusy('batch-outdated')} />
        <input aria-label="Search projects" />
      </>
    }
    render(<BusyWorkspace />)
    trigger().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(trigger().disabled).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Workspace actions' })))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search projects' }))
  })

  it('keeps preview capture and directory resync directly available', async () => {
    const user = userEvent.setup(), actions = callbacks()
    render(<WorkspaceToolbar {...actions} workspace={workspace} projectCount={1} busy="" />)
    await user.click(screen.getByRole('button', { name: 'Capture previews', exact: true }))
    await user.click(screen.getByRole('button', { name: /^Synced/ }))
    expect(actions.captureAllPreviews).toHaveBeenCalledOnce()
    expect(actions.onResync).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    { name: 'demo', workspace: undefined, projectCount: 3, busy: '' },
    { name: 'empty', workspace: { ...workspace, projects: [] }, projectCount: 0, busy: '' },
    { name: 'scanning', workspace, projectCount: 1, busy: 'batch-audit' },
    { name: 'capturing', workspace, projectCount: 1, busy: 'batch-capture' },
    { name: 'other helper work', workspace, projectCount: 1, busy: 'fixture:storage' },
  ])('prevents opening checks in a $name workspace', async ({ workspace: value, projectCount, busy }) => {
    const user = userEvent.setup(), actions = callbacks()
    render(<WorkspaceToolbar {...actions} workspace={value} projectCount={projectCount} busy={busy} />)
    expect(trigger().disabled).toBe(true)
    expect(trigger().getAttribute('aria-busy')).toBe(String(busy === 'batch-audit'))
    if (busy === 'batch-audit') expect(trigger().textContent).toContain('Checking…')
    await user.click(trigger())
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Capture previews' }).disabled).toBe(true)
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled()
  })

  it('disables unavailable checks while retaining package checks and their explanations', async () => {
    const user = userEvent.setup(), actions = callbacks()
    const backend = { ...project, stack: [], scripts: { start: 'node server.js' }, git: undefined }
    render(<WorkspaceToolbar {...actions} workspace={{ ...workspace, projects: [backend] }} projectCount={1} busy="" />)
    await user.click(trigger())
    for (const label of ['Check issues & PRs', 'Scan React projects', 'Scan frontends with Lighthouse']) {
      const item = screen.getByRole('menuitem', { name: label })
      expect(item.getAttribute('aria-disabled')).toBe('true')
      await user.click(item)
    }
    expect(screen.getByRole('menuitem', { name: 'Scan React projects' }).title).toBe('No React projects found in this workspace')
    expect(screen.getByRole('menuitem', { name: 'Scan frontends with Lighthouse' }).title).toBe('No testable frontend projects found in this workspace')
    for (const label of ['Scan outdated packages', 'Scan vulnerabilities']) {
      expect(screen.getByRole('menuitem', { name: label }).getAttribute('aria-disabled')).not.toBe('true')
    }
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled()
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Scan outdated packages' }))
  })

  it('blocks checks if work begins while the menu is already open', async () => {
    const user = userEvent.setup(), actions = callbacks()
    const { rerender } = render(<WorkspaceToolbar {...actions} workspace={workspace} projectCount={1} busy="" />)
    await user.click(trigger())
    rerender(<WorkspaceToolbar {...actions} workspace={workspace} projectCount={1} busy="batch-audit" />)
    for (const [label] of checks) {
      const item = screen.getByRole('menuitem', { name: label })
      expect(item.getAttribute('aria-disabled')).toBe('true')
      await user.click(item)
    }
    expect(screen.getByRole('menuitem', { name: 'Scan vulnerabilities' }).getAttribute('aria-busy')).toBe('true')
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled()
  })
})

describe('cached report disclosure', () => {
  const cached: Workspace = {
    ...workspace,
    projects: [{ ...project, reportState: { audit: { helperInstanceId: 'previous', revision: 1, validity: 'unknown' } } }],
  }

  it('keeps cached report guidance collapsed until requested in the workspace toolbar', async () => {
    const user = userEvent.setup()
    render(<WorkspaceToolbar {...callbacks()} workspace={cached} projectCount={1} busy="" />)
    const summary = screen.getByText('Cached reports').closest('summary')!
    const disclosure = summary.closest('details')!
    expect(disclosure.open).toBe(false)
    await user.click(summary)
    expect(disclosure.open).toBe(true)
    expect(disclosure.textContent).toContain('Some reports have unknown freshness after reconnecting. Rerun their scans to refresh them.')
    await user.keyboard('{Escape}')
    expect(disclosure.open).toBe(false)
    expect(document.activeElement).toBe(summary)
  })

  it('retains full status guidance outside the compact toolbar and hides it for known reports', () => {
    const { rerender } = render(<WorkspaceReportNote workspace={cached} />)
    expect(screen.getByRole('status').textContent).toContain('Some reports have unknown freshness after reconnecting.')
    expect(screen.queryByText('Cached reports', { selector: 'summary' })).toBeNull()
    rerender(<WorkspaceReportNote workspace={workspace} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/Cached reports/)).toBeNull()
  })
})
