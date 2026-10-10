// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectDetailDialog } from './project-detail-dialog'
import type { ProjectTab } from './project-tabs'
import { projectHistory } from '@/lib/api'
import type { RepoProject } from '@/types'

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), projectHistory: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: 'A local project.',
  version: '1.2.3', stack: [], scripts: { dev: 'vite', test: 'vitest' }, packageManager: 'npm',
  scannedAt: '2026-10-10T12:00:00Z', dependencies: [{ name: 'vite', version: '^8.0.0', kind: 'devDependencies' }],
}

function Detail({ onAction = vi.fn() }: { onAction?: ReturnType<typeof vi.fn> }) {
  const [tab, setTab] = useState<ProjectTab>('overview')
  return <ProjectDetailDialog selected={project} detailTab={tab} onTabChange={setTab} helper demo={false}
    busy="" packageBusy="" tagsReady selectedTags={new Set()} favorite={false} logs="Server output"
    onClose={vi.fn()} onCloseAutoFocus={vi.fn()} onTagFilter={vi.fn()} onEditTags={vi.fn()}
    onToggleFavorite={vi.fn()} onAction={onAction} />
}

describe('project detail sections', () => {
  it('keeps overview and packages focused and exposes operations in their own tabs', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Detail onAction={onAction} />)
    expect(within(screen.getByRole('tabpanel')).getByText('v1.2.3')).toBeTruthy()
    expect(screen.queryByText('Development server')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Commit history' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Project disk usage' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Storage' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Measure disk usage' }))
    expect(onAction).toHaveBeenLastCalledWith(project, 'storage', undefined)

    await user.click(screen.getByRole('tab', { name: 'Packages' }))
    expect(screen.getByRole('textbox', { name: 'Filter packages in project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Scan/ })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Development' }))
    expect(screen.getByText('Server output')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start server' }))
    expect(onAction).toHaveBeenLastCalledWith(project, 'start', undefined)
    expect(screen.queryByRole('region', { name: 'Project disk usage' })).toBeNull()

    for (const [tab, button, action] of [
      ['Vulnerabilities', 'Scan for vulnerabilities', 'audit'],
      ['Updates', 'Scan for outdated packages', 'outdated'],
      ['Unused', 'Scan for unused packages', 'unused'],
    ]) {
      await user.click(screen.getByRole('tab', { name: tab }))
      await user.click(screen.getByRole('button', { name: button }))
      expect(onAction).toHaveBeenLastCalledWith(project, action, undefined)
      expect(screen.queryByRole('textbox', { name: 'Filter packages in project' })).toBeNull()
    }
    expect(projectHistory).not.toHaveBeenCalled()
  })

  it('loads Git history only after selecting History and preserves keyboard tab navigation', async () => {
    vi.mocked(projectHistory).mockResolvedValue({ available: true, branches: [], authors: [], commits: [], total: 0, offset: 0, hasMore: false, activity: [], from: '2026-10-01', to: '2026-10-10', shallow: false })
    const user = userEvent.setup()
    render(<Detail />)
    expect(projectHistory).not.toHaveBeenCalled()
    screen.getByRole('tab', { name: 'Overview' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'History', selected: true }))
    expect(await screen.findByText('No commits yet.')).toBeTruthy()
    expect(projectHistory).toHaveBeenCalledExactlyOnceWith(project.id, { branch: '', author: '', offset: 0 })

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'README', selected: true }))
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(document.activeElement?.id)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview', selected: true }))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'README', selected: true }))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview', selected: true }))
  })
})
