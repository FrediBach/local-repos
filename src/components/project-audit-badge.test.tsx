// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuditSeverity, PackageAudit, RepoProject } from '../types'
import { ProjectAuditBadge } from './project-audit-badge'

afterEach(cleanup)

const project: RepoProject = {
  id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '2026-10-07T12:00:00Z',
}
const cleanReport: PackageAudit = {
  manager: 'npm', scannedAt: '2026-10-07T12:00:00Z', counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, findings: [],
}

describe('project vulnerability badge', () => {
  it('shows no badge for unscanned or clean projects', () => {
    const { rerender, container } = render(<ProjectAuditBadge project={project} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    rerender(<ProjectAuditBadge project={{ ...project, audit: cleanReport }} onClick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it.each<AuditSeverity>(['critical', 'high', 'moderate', 'low', 'info'])('uses %s styling when it is the highest severity', severity => {
    const counts = { ...cleanReport.counts, info: 2, [severity]: 3 }
    const total = severity === 'info' ? 3 : 5
    render(<ProjectAuditBadge project={{ ...project, audit: { ...cleanReport, counts } }} onClick={vi.fn()} />)
    const badge = screen.getByRole('button', { name: `Fixture: ${total} vulnerabilities, highest severity ${severity}. View audit details` })
    expect(badge.classList.contains(`audit-severity-${severity}`)).toBe(true)
    expect(badge.textContent).toBe(String(total))
    expect(badge.title).toContain(`3 ${severity}`)
    expect(badge.title).toContain(`Last scan: ${new Date(cleanReport.scannedAt).toLocaleString()}`)
  })

  it('describes a single vulnerability and opens its details by keyboard', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ProjectAuditBadge project={{ ...project, audit: { ...cleanReport, counts: { ...cleanReport.counts, high: 1 } } }} onClick={onClick} />)
    screen.getByRole('button', { name: 'Fixture: 1 vulnerability, highest severity high. View audit details' }).focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('updates to show no badge when a rescan resolves all findings', () => {
    const onClick = vi.fn()
    const { rerender } = render(<ProjectAuditBadge project={{ ...project, audit: { ...cleanReport, counts: { ...cleanReport.counts, critical: 2 } } }} onClick={onClick} />)
    expect(screen.getByRole('button', { name: /2 vulnerabilities/ })).toBeTruthy()
    rerender(<ProjectAuditBadge project={{ ...project, audit: cleanReport }} onClick={onClick} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
