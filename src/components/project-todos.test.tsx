// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTodos } from './project-todos'
import type { ProjectTodo } from '@/lib/project-todos'
import type { RepoProject } from '@/types'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const scannedAt = '2026-10-08T12:00:00Z'
const project: RepoProject = { id: 'notes', name: 'Notebook', dirName: 'notebook', relativePath: 'apps/notebook', stack: ['React'], scripts: {}, description: '', packageManager: 'npm', scannedAt }
const scannedProject: RepoProject = { ...project, audit: { manager: 'npm', scannedAt, counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 1 }, findings: [] } }
const website: RepoProject = { ...scannedProject, id: 'website', name: 'Website', relativePath: 'apps/website' }
const security: ProjectTodo = { id: 'notes:security', projectId: 'notes', kind: 'security', priority: 'critical', title: 'Resolve security issues', description: '1 critical vulnerability needs attention.', tab: 'packages', scannedAt, findingKeys: ['security-a'] }
const outdated: ProjectTodo = { ...security, id: 'notes:outdated', kind: 'outdated', priority: 'high', title: 'Update outdated packages', description: 'Review 2 packages with significant version lag.', findingKeys: ['outdated-a'] }
const doctor: ProjectTodo = { ...security, id: 'website:react-doctor', projectId: 'website', kind: 'react-doctor', priority: 'high', title: 'Fix React Doctor errors', description: 'Review 3 errors.', tab: 'react-doctor', findingKeys: ['doctor-a'] }
const props = { projects: [website, scannedProject], todos: [doctor, outdated, security], onClearProject: vi.fn(), onOpen: vi.fn(), onDismiss: vi.fn(), isDemo: false, onConnect: vi.fn() }

describe('automatic project todos', () => {
  it('groups tasks by project, puts critical tasks first, and summarizes the current list', () => {
    render(<ProjectTodos {...props} />)
    const groups = screen.getAllByRole('article')
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['Notebook todos', 'Website todos'])
    expect(within(groups[0]).getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual([security.title, outdated.title])
    const stats = screen.getByLabelText('Todo overview')
    expect(within(stats).getAllByRole('definition').map(item => item.textContent)).toEqual(['3', '1', '2', '2 / 2'])
    expect(screen.getByText(/Only high or critical security issues/)).toBeTruthy()
    expect(screen.getByText(/Dismissed findings stay hidden while unchanged/)).toBeTruthy()
    expect(document.querySelector('.todos-task time')?.getAttribute('datetime')).toBe('2026-10-08T12:00:00.000Z')
  })

  it('opens each task’s matching report and dismisses the exact selected task', async () => {
    const user = userEvent.setup()
    render(<ProjectTodos {...props} />)
    await user.click(screen.getByRole('button', { name: `Review ${security.title} in Notebook` }))
    expect(props.onOpen).toHaveBeenLastCalledWith(scannedProject, 'packages')
    await user.click(screen.getByRole('button', { name: `Review ${doctor.title} in Website` }))
    expect(props.onOpen).toHaveBeenLastCalledWith(website, 'react-doctor')
    const dismiss = screen.getByRole('button', { name: `Dismiss ${outdated.title} in Notebook` })
    expect(document.getElementById(dismiss.getAttribute('aria-describedby')!)?.textContent).toContain('Dismissed findings stay hidden')
    await user.click(dismiss)
    expect(props.onDismiss).toHaveBeenCalledExactlyOnceWith(outdated)
    expect(props.onClearProject).not.toHaveBeenCalled()
  })

  it('keeps project context after the last todo is dismissed and lets users return to all todos', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProjectTodos {...props} projectId="website" />)
    expect(screen.queryByRole('article', { name: 'Notebook todos' })).toBeNull()
    await user.click(screen.getByRole('button', { name: `Dismiss ${doctor.title} in Website` }))
    rerender(<ProjectTodos {...props} projectId="website" todos={[security, outdated]} />)
    expect(screen.getByRole('heading', { name: 'No important active todos.' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'No important active todos.' }))
    expect(screen.getByText('Website')).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Notebook todos' })).toBeNull()
    expect(props.onClearProject).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'All todos' }))
    expect(props.onClearProject).toHaveBeenCalledOnce()
  })

  it('keeps keyboard focus on the next task, or the previous task when dismissing the last row', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProjectTodos {...props} />)
    const firstDismiss = screen.getByRole('button', { name: `Dismiss ${security.title} in Notebook` })
    firstDismiss.focus()
    await user.keyboard('{Enter}')
    expect(props.onDismiss).toHaveBeenLastCalledWith(security)
    rerender(<ProjectTodos {...props} todos={[outdated, doctor]} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Dismiss ${outdated.title} in Notebook` }))
    const lastDismiss = screen.getByRole('button', { name: `Dismiss ${doctor.title} in Website` })
    lastDismiss.focus()
    await user.keyboard(' ')
    expect(props.onDismiss).toHaveBeenLastCalledWith(doctor)
    rerender(<ProjectTodos {...props} todos={[outdated]} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Dismiss ${outdated.title} in Notebook` }))
  })

  it('does not steal focus when a dismissal completes after the user has moved elsewhere', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProjectTodos {...props} projectId="notes" />)
    await user.click(screen.getByRole('button', { name: `Dismiss ${security.title} in Notebook` }))
    const allTodos = screen.getByRole('button', { name: 'All todos' })
    allTodos.focus()
    rerender(<ProjectTodos {...props} projectId="notes" todos={[outdated, doctor]} />)
    expect(document.activeElement).toBe(allTodos)
  })

  it('distinguishes directory discovery from finding scans and offers the project scan controls', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProjectTodos {...props} projects={[project]} projectId={project.id} todos={[]} />)
    expect(screen.getByRole('heading', { name: 'Run a scan to find important tasks.' })).toBeTruthy()
    expect(screen.getByText('No scans yet')).toBeTruthy()
    expect(screen.queryByText('No important active todos.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open project scans' }))
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(project, 'packages')
    rerender(<ProjectTodos {...props} projects={[scannedProject]} projectId={project.id} todos={[]} />)
    expect(screen.getByRole('heading', { name: 'No important active todos.' })).toBeTruthy()
    expect(screen.getByText(/There are no active tasks from the available scans/)).toBeTruthy()
  })

  it('updates scan coverage, timestamps, and tasks as incoming scan results change', () => {
    const { rerender } = render(<ProjectTodos {...props} projects={[scannedProject, { ...website, audit: undefined }]} todos={[security]} />)
    expect(screen.getByText('1 project has no scans yet. Their findings are not included.')).toBeTruthy()
    rerender(<ProjectTodos {...props} projects={[scannedProject, { ...website, audit: { ...website.audit!, scannedAt: '2026-10-09T15:00:00Z' } }]} todos={[doctor]} />)
    expect(screen.queryByText(/project has no scans yet/)).toBeNull()
    expect(screen.queryByRole('listitem', { name: security.title })).toBeNull()
    expect(screen.getByRole('listitem', { name: doctor.title })).toBeTruthy()
    expect(document.querySelector('.todos-scope time')?.getAttribute('datetime')).toBe('2026-10-09T15:00:00.000Z')
  })

  it('keeps demo connection and missing-project recovery available', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProjectTodos {...props} isDemo />)
    await user.click(screen.getByRole('button', { name: 'Connect directory' }))
    expect(props.onConnect).toHaveBeenCalledOnce()
    rerender(<ProjectTodos {...props} projectId="removed-project" />)
    expect(screen.getByRole('heading', { name: 'This project is no longer available.' })).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'All todos' }))
    expect(props.onClearProject).toHaveBeenCalledOnce()
  })
})
