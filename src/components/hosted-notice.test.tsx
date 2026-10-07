// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HostedNotice } from './hosted-notice'

let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> }

beforeEach(() => {
  const saved = new Map<string, string>()
  storage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value) }),
  }
  vi.stubGlobal('sessionStorage', storage)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('opens automatically, explains both modes, and links to installation', () => {
  render(<HostedNotice />)
  const dialog = screen.getByRole('dialog', { name: 'Your projects, from the browser.' })
  expect(within(dialog).getByRole('heading', { name: 'Available here' })).toBeTruthy()
  expect(within(dialog).getByRole('heading', { name: 'Run locally for' })).toBeTruthy()
  expect(within(dialog).getByText(/Installing this web app alone does not enable them/)).toBeTruthy()
  expect(within(dialog).getByRole('link', { name: 'Installation on GitHub' }).getAttribute('href')).toBe('https://github.com/FrediBach/local-repos#run-locally')
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Your projects, from the browser.' }))
})

it('remembers dismissal for this session while allowing the notice to reopen', async () => {
  const user = userEvent.setup()
  const view = render(<HostedNotice />)
  await user.click(screen.getByRole('button', { name: 'Continue browsing' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.unmount()
  render(<HostedNotice />)
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Hosted version' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hosted version' }))
})

it('stays dismissible and reopenable when session storage is blocked', async () => {
  storage.getItem.mockImplementation(() => { throw new Error('Storage blocked') })
  storage.setItem.mockImplementation(() => { throw new Error('Storage blocked') })
  const user = userEvent.setup()
  render(<HostedNotice />)
  await user.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Hosted version' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
})
