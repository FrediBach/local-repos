// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createFaviconIndicator } from './favicon'

beforeEach(() => {
  document.head.innerHTML = '<title>Local Repos</title><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">'
})

afterEach(() => {
  document.head.innerHTML = ''
})

function iconLinks() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i]'))
}

function iconSvg() {
  const href = iconLinks()[0].getAttribute('href')!
  expect(href).toMatch(/^data:image\/svg\+xml,/)
  return new DOMParser().parseFromString(decodeURIComponent(href.split(',')[1]), 'image/svg+xml')
}

it('updates every favicon candidate and the title, preserving touch icons and the brand mark', () => {
  const touchIcon = document.querySelector('link[rel="apple-touch-icon"]')!.outerHTML
  const indicator = createFaviconIndicator()
  indicator.update('security', '2 new vulnerabilities')

  const links = iconLinks()
  expect(links).toHaveLength(2)
  expect(links[0].href).toBe(links[1].href)
  for (const link of links) {
    expect(link.getAttribute('type')).toBe('image/svg+xml')
    expect(link.getAttribute('sizes')).toBe('any')
  }
  expect(document.title).toBe('2 new vulnerabilities — Local Repos')
  expect(document.querySelector('link[rel="apple-touch-icon"]')!.outerHTML).toBe(touchIcon)
  const svg = iconSvg()
  expect(svg.querySelector('parsererror')).toBeNull()
  expect(svg.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64')
  expect(svg.querySelector('g[fill="#f5f4ef"]')?.children).toHaveLength(3)
  expect(svg.querySelector('circle[fill="#b91c1c"]')).not.toBeNull()
  expect(svg.querySelector('path[stroke="#fff"]')).not.toBeNull()
  expect(svg.querySelector('animate')).toBeNull()
  indicator.dispose()
})

it('switches static indicators without adding links or stacking title prefixes', () => {
  const indicator = createFaviconIndicator()
  indicator.update('activity', 'New pull request')
  const activityIcon = iconLinks()[0].href
  expect(iconSvg().querySelector('circle[fill="#2563eb"]')).not.toBeNull()

  indicator.update('warning', 'New moderate vulnerability')
  const warningIcon = iconLinks()[0].href
  expect(warningIcon).not.toBe(activityIcon)
  expect(iconSvg().querySelector('circle[fill="#b45309"]')).not.toBeNull()
  indicator.update('security')
  expect(iconLinks()[0].href).not.toBe(warningIcon)
  expect(document.title).toBe('New high or critical vulnerabilities — Local Repos')
  indicator.update('activity', 'New pull request')
  expect(iconLinks()[0].href).toBe(activityIcon)
  expect(document.title).toBe('New pull request — Local Repos')
  expect(iconLinks()).toHaveLength(2)
  indicator.dispose()
})

it('restores exact original attributes, absent attributes and title when cleared or disposed', () => {
  document.head.insertAdjacentHTML('beforeend', '<link rel="shortcut icon" media="(prefers-color-scheme: dark)">')
  const original = document.head.innerHTML
  const indicator = createFaviconIndicator()
  indicator.update(undefined)
  expect(document.head.innerHTML).toBe(original)
  indicator.update('warning')
  expect(iconLinks()).toHaveLength(3)
  indicator.update(undefined)
  expect(document.head.innerHTML).toBe(original)
  indicator.update('activity')
  indicator.dispose()
  expect(document.head.innerHTML).toBe(original)
  indicator.dispose()
  indicator.update('security')
  expect(document.head.innerHTML).toBe(original)
})

it('owns a single temporary icon when none exists and removes it again', () => {
  for (const link of iconLinks()) link.remove()
  const original = document.head.innerHTML
  const indicator = createFaviconIndicator()
  expect(iconLinks()).toHaveLength(0)
  indicator.update('warning')
  indicator.update('activity')
  expect(iconLinks()).toHaveLength(1)
  indicator.update(undefined)
  expect(document.head.innerHTML).toBe(original)
  indicator.update('security')
  expect(iconLinks()).toHaveLength(1)
  indicator.dispose()
  expect(document.head.innerHTML).toBe(original)
})

it('supports setup-cleanup-setup and cleanup with no initial title or icon', () => {
  document.head.innerHTML = '<meta name="color-scheme" content="light dark">'
  const original = document.head.innerHTML
  const first = createFaviconIndicator()
  first.update('security')
  expect(document.title).toBe('New high or critical vulnerabilities')
  first.dispose()
  expect(document.head.innerHTML).toBe(original)

  const second = createFaviconIndicator()
  second.update('activity', '1 new issue')
  expect(iconLinks()).toHaveLength(1)
  expect(document.title).toBe('1 new issue')
  first.update('warning')
  expect(document.title).toBe('1 new issue')
  second.dispose()
  expect(document.head.innerHTML).toBe(original)
})
