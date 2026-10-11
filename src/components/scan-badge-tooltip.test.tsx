// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScanBadgeTooltip } from './scan-badge-tooltip'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows a relative date on keyboard focus, dismisses with Escape, and preserves the action', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T12:00:00Z'))
  const user = userEvent.setup()
  const onClick = vi.fn()
  render(<ScanBadgeTooltip heading="Package updates" details="2 outdated packages" scannedAt="2026-10-11T09:30:00Z"><button onClick={onClick}>Updates</button></ScanBadgeTooltip>)
  expect(screen.queryByRole('tooltip')).toBeNull()
  await user.tab()
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip.textContent).toContain('Package updates')
  expect(tooltip.textContent).toContain('2 outdated packages')
  expect(tooltip.textContent).toContain('2½ hours ago')
  expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(tooltip.id)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  expect(document.activeElement).toBe(screen.getByRole('button'))
  await user.keyboard('{Enter}')
  expect(onClick).toHaveBeenCalledOnce()
})

it('refreshes the age when reopened after time has passed', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T12:00:00Z'))
  const user = userEvent.setup()
  render(<ScanBadgeTooltip heading="Audit" details="1 vulnerability" scannedAt="2026-10-11T11:58:00Z"><button>Audit</button></ScanBadgeTooltip>)
  const badge = screen.getByRole('button')
  await user.hover(badge)
  expect((await screen.findByRole('tooltip')).textContent).toContain('2 minutes ago')
  await user.keyboard('{Escape}')
  await user.unhover(badge)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  clock.mockReturnValue(Date.parse('2026-10-11T12:03:00Z'))
  await user.hover(badge)
  expect((await screen.findByRole('tooltip')).textContent).toContain('5 minutes ago')
})
