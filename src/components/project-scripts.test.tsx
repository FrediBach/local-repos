// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RepoProject } from '../types'
import { ProjectControls } from './project-controls'

afterEach(cleanup)
const project: RepoProject = { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], packageManager: 'pnpm', scannedAt: '', scripts: { dev: 'vite', 'test:watch': 'vitest', sb: 'storybook dev -p 6006', 'generate:component': 'plop component', prepare: 'husky', utility: 'node scripts/utility.js' } }

describe('project script actions', () => {
  it('groups detected tasks, keeps the primary dev action, and launches the selected variant', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<ProjectControls project={project} helper demo={false} busy="" onAction={action} />)
    expect(screen.getByRole('button', { name: 'Start server' })).toBeTruthy()
    const scripts = within(screen.getByRole('region', { name: 'Project scripts' }))
    expect(scripts.queryByText('pnpm run dev')).toBeNull()
    expect(scripts.queryByText('husky')).toBeNull()
    expect(scripts.getByRole('heading', { name: 'Storybook' })).toBeTruthy()
    expect(scripts.getByRole('heading', { name: 'Tests' })).toBeTruthy()
    expect(scripts.getByRole('heading', { name: 'Scaffolding & code generation' })).toBeTruthy()
    expect(scripts.getByText('pnpm run test:watch')).toBeTruthy()
    await user.click(scripts.getByRole('button', { name: 'Run generate:component in terminal' }))
    expect(action).toHaveBeenCalledExactlyOnceWith('run-script', { name: 'generate:component', command: 'plop component' })
    await user.click(scripts.getByText(/Other scripts/))
    expect(scripts.getByRole('button', { name: 'Run utility in terminal' })).toBeTruthy()
  })

  it('makes scripts available even without a dev server and copies commands in browser mode', async () => {
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ProjectControls project={{ ...project, scripts: { test: 'vitest run' } }} helper={false} demo={false} busy="" onAction={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Start server' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Copy test command' }))
    expect(clipboard).toHaveBeenCalledWith('pnpm run test')
    expect(screen.getByRole('status').textContent).toBe('Copied test command.')
  })

  it('disables launches during another action', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<ProjectControls project={project} helper demo={false} busy="batch-audit" onAction={action} />)
    await user.click(screen.getByRole('button', { name: 'Run sb in terminal' }))
    expect(action).not.toHaveBeenCalled()
  })
})
