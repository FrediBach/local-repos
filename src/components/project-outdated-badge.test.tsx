// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PackageOutdated, RepoProject } from '../types'
import { ProjectOutdatedBadge } from './project-outdated-badge'

afterEach(cleanup)

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
}
const report: PackageOutdated = {
  manager: 'npm', scannedAt: '2026-10-07T12:00:00Z', score: 0.3, level: 'low',
  findings: [{ name: 'example', current: '1.0.0', latest: '1.0.3', change: 'patch', majorGap: 0, score: 0.3 }],
}

describe('project outdated badge', () => {
  it('hides unscanned and current projects without suggesting an unscanned project is current', () => {
    const { rerender, container } = render(<ProjectOutdatedBadge project={project} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    rerender(<ProjectOutdatedBadge project={{ ...project, outdated: { ...report, findings: [], score: 0, level: 'current' } }} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the summed update score with muted styling for ordinary patch updates', () => {
    render(<ProjectOutdatedBadge project={{ ...project, outdated: report }} onClick={vi.fn()} />)
    const badge = screen.getByRole('button', { name: 'Fixture: 1 outdated package, update score 0.3. View outdated package details' })
    expect(badge.textContent).toBe('0.3')
    expect(badge.classList.contains('outdated-level-low')).toBe(true)
    expect(badge.title).toContain(`Last scan: ${new Date(report.scannedAt).toLocaleString()}`)
  })

  it('reflects the calculated moderate or high level and clears resolved results', () => {
    const findings: PackageOutdated['findings'] = [
      { name: 'first', current: '1.0.0', latest: '2.0.0', change: 'major', majorGap: 1, score: 10 },
      { name: 'second', current: '1.0.0', latest: '2.0.0', change: 'major', majorGap: 1, score: 10 },
    ]
    const { rerender } = render(<ProjectOutdatedBadge project={{ ...project, outdated: { ...report, findings, score: 20, level: 'moderate' } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /2 outdated packages, update score 20/ }).classList.contains('outdated-level-moderate')).toBe(true)
    rerender(<ProjectOutdatedBadge project={{ ...project, outdated: { ...report, findings: [{ ...findings[0], latest: '11.0.0', majorGap: 10, score: 100 }], score: 100, level: 'high' } }} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /update score 100/ }).classList.contains('outdated-level-high')).toBe(true)
    rerender(<ProjectOutdatedBadge project={{ ...project, outdated: { ...report, findings: [], score: 0, level: 'current' } }} onClick={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens outdated details by keyboard', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<ProjectOutdatedBadge project={{ ...project, outdated: report }} onClick={onClick} />)
    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })
})
