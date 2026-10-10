import { describe, expect, it } from 'vitest'
import { isFrontendDevScript, isLighthouseProject, lighthousePerformanceScore, lighthouseScoreLevel } from './lighthouse'
import type { LighthouseReport } from '../types'

describe('Lighthouse frontend eligibility', () => {
  it.each(['vite', 'vite --host 127.0.0.1', 'next dev', 'next start', 'astro dev', 'astro preview', 'nuxt dev', 'nuxi dev', 'ng serve', 'vue-cli-service serve', 'webpack serve', 'webpack-dev-server', 'parcel index.html', 'react-scripts start', 'cross-env NODE_ENV=development vite', 'PORT=3001 next dev', 'npx vite', './node_modules/.bin/vite'])('recognizes a frontend server: %s', command => {
    expect(isFrontendDevScript(command)).toBe(true)
    expect(isLighthouseProject({ scripts: { dev: command } })).toBe(true)
  })

  it.each(['node server.js', 'tsx watch api.ts', 'nest start --watch', 'tsup --watch', 'vite build --watch', 'next build', 'nuxt generate', 'astro check', 'parcel watch index.html', 'react-scripts test', 'expo start', 'echo vite', 'echo "next dev"', 'npm run frontend', 'turbo dev', 'vite --help', 'vite --version', 'vite && node server.js', 'node scripts/dev.mjs', '$(echo vite)', 'vite --port $PORT'])('does not infer a frontend from %s', command => {
    expect(isFrontendDevScript(command)).toBe(false)
  })

  it.each([
    'vite web', 'vite ./frontend', 'vite "web app"', 'vite --mode development web',
    'vite --config=build.config.ts ./frontend', 'vite -mdevelopment ./frontend',
    'vite --port 3000 --strictPort', 'vite --host --mode development', 'vite --mode build',
    'next', 'next --port 3000 dev', 'nuxt --dotenv .env dev', 'astro --root web dev',
    'cross-env NODE_OPTIONS="--max-old-space-size=4096 --enable-source-maps" vite',
    'env APP_NAME="My web app" npx vite',
  ])('recognizes roots, option values, and quoted environment wrappers: %s', command => {
    expect(isFrontendDevScript(command)).toBe(true)
  })

  it.each([
    'vite --mode production build', 'vite --mode=production build', 'vite -mproduction build',
    'vite --config vite.config.ts optimize', 'vite --port 3000 --watch',
    'nuxt --dotenv .env build', 'nuxt --port 3000 generate', 'nuxi --cwd app prepare',
    'parcel --port 3000 watch index.html', 'parcel --dist-dir dist build index.html',
    'next --port 3000 build', 'astro --root web build', 'webpack --mode production build',
    'vite --unknown-option value', 'vite --mode', 'vite --mode "" build', 'vite "web',
  ])('skips non-serving and ambiguous commands even with leading options: %s', command => {
    expect(isFrontendDevScript(command)).toBe(false)
  })

  it('uses the same selected startup script as the helper, without substituting a later script', () => {
    expect(isLighthouseProject({ scripts: { dev: 'node api.js', start: 'vite' } })).toBe(false)
    expect(isLighthouseProject({ scripts: { build: 'vite build', preview: 'vite preview' } })).toBe(false)
    expect(isLighthouseProject({ scripts: { dev: '', serve: 'ng serve' } })).toBe(true)
  })

  it('requires an explicit valid frontend URL for custom launchers, libraries, or backend repositories', () => {
    expect(isLighthouseProject({ scripts: {}, previewUrl: 'https://example.com/app' })).toBe(true)
    expect(isLighthouseProject({ scripts: {}, previewUrl: 'http://localhost:4000' })).toBe(true)
    for (const previewUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://github.com/owner/repo', 'https://example.com/ with-space']) {
      expect(isLighthouseProject({ scripts: {}, previewUrl })).toBe(false)
    }
    const library = { scripts: {}, homepage: 'https://library.example.com', stack: ['React'], dependencies: [{ name: 'react', version: '*', kind: 'peerDependencies' as const }] }
    expect(isLighthouseProject(library)).toBe(false)
  })
})

it('uses Lighthouse thresholds and preserves unavailable and zero scores', () => {
  expect([null, NaN, -1, 101].map(lighthouseScoreLevel)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
  expect([0, 49, 50, 89, 90, 100].map(lighthouseScoreLevel)).toEqual(['poor', 'poor', 'warning', 'warning', 'good', 'good'])
  const report: LighthouseReport = { scannedAt: '', version: '', url: '', requestedUrl: '', formFactor: 'desktop', categories: [{ id: 'accessibility', title: 'Accessibility', score: 100 }], audits: [], warnings: [] }
  expect(lighthousePerformanceScore(report)).toBeNull()
  expect(lighthousePerformanceScore({ ...report, categories: [{ id: 'performance', title: 'Performance', score: 0 }] })).toBe(0)
  expect(lighthousePerformanceScore({ ...report, categories: [{ id: 'performance', title: 'Performance', score: null }] })).toBeNull()
})
