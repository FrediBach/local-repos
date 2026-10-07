import { afterEach, describe, expect, it, vi } from 'vitest'
import { isVercelHosted } from './deployment'

afterEach(() => vi.unstubAllEnvs())

describe('Vercel deployment detection', () => {
  it('recognizes production and preview Vercel domains without the build flag', () => {
    vi.stubEnv('VITE_VERCEL_HOSTED', '')
    expect(isVercelHosted('local-repos.vercel.app')).toBe(true)
    expect(isVercelHosted('local-repos-git-feature-team.vercel.app')).toBe(true)
    expect(isVercelHosted('LOCAL-REPOS.VERCEL.APP.')).toBe(true)
    expect(isVercelHosted('local-repos.vercel.app.example.com')).toBe(false)
    expect(isVercelHosted('not-vercel.app')).toBe(false)
    expect(isVercelHosted('repos.example.com')).toBe(false)
  })

  it('recognizes custom domains built on Vercel', () => {
    vi.stubEnv('VITE_VERCEL_HOSTED', '1')
    expect(isVercelHosted('repos.example.com')).toBe(true)
  })

  it.each(['localhost', 'app.localhost', '127.0.0.1', '127.0.0.2', '[::1]', '::1'])('keeps a downloaded build local on %s', hostname => {
    vi.stubEnv('VITE_VERCEL_HOSTED', '1')
    expect(isVercelHosted(hostname)).toBe(false)
  })
})
