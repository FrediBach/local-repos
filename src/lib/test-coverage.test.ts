import { describe, expect, it } from 'vitest'
import { canInspectCoverage, coverageLevel, coveragePercent, detectCoverageRunner, formatCoveragePercent, isCoverageProject, selectCoverageScript } from './test-coverage'
import type { ProjectDependency, RepoProject } from '../types'

const project = { scripts: {}, hasPackageJson: true }
const dependency = (name: string): ProjectDependency => ({ name, version: '*', kind: 'devDependencies' })

describe('coverage runner detection', () => {
  it.each(['vitest', 'jest', 'react-scripts'] as const)('recognizes installed %s tooling', runner => {
    expect(detectCoverageRunner({ ...project, dependencies: [dependency(runner)] })).toBe(runner)
  })

  it('uses the first meaningful test script and preserves its native arguments', () => {
    const scripts = { 'test:coverage': 'jest --config "configs/unit tests.js"', test: 'vitest' }
    expect(detectCoverageRunner({ ...project, scripts, dependencies: [dependency('vitest')] })).toBe('jest')
    expect(selectCoverageScript(scripts)).toEqual({ runner: 'jest', args: ['--config', 'configs/unit tests.js'] })
    expect(selectCoverageScript({ test: './node_modules/.bin/vitest run src/unit' })).toEqual({ runner: 'vitest', args: ['src/unit'] })
    expect(selectCoverageScript({ test: 'react-scripts test --env=jsdom' })).toEqual({ runner: 'react-scripts', args: ['--env=jsdom'] })
    expect(selectCoverageScript({ test: 'echo "Error: no test specified" && exit 1' })).toBeUndefined()
  })

  it.each(['', 'env ', 'cross-env '])('preserves literal environment assignments with the %s prefix', prefix => {
    const scripts = { 'test:coverage': `${prefix}NODE_OPTIONS=--no-experimental-webstorage vitest run --coverage` }
    expect(selectCoverageScript(scripts)).toEqual({ runner: 'vitest', args: ['--coverage'], env: { NODE_OPTIONS: '--no-experimental-webstorage' } })
    expect(detectCoverageRunner({ ...project, scripts, dependencies: [dependency('vitest')] })).toBe('vitest')
  })

  it('preserves multiple environment assignments and quoted values', () => {
    expect(selectCoverageScript({ test: 'NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key jest' })).toEqual({
      runner: 'jest', args: [], env: { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' },
    })
    expect(selectCoverageScript({ test: 'env TZ=UTC TEST_LABEL="unit tests" EMPTY= SETTING="a=b" vitest run --config "configs/unit tests.ts"' })).toEqual({
      runner: 'vitest', args: ['--config', 'configs/unit tests.ts'], env: { TZ: 'UTC', TEST_LABEL: 'unit tests', EMPTY: '', SETTING: 'a=b' },
    })
    expect(selectCoverageScript({ test: 'TZ=UTC cross-env TZ=Europe/Zurich vitest run' })?.env).toEqual({ TZ: 'Europe/Zurich' })
  })

  it.each(['cross-env-shell TZ=UTC vitest', 'env -i TZ=UTC vitest', '1INVALID=value vitest', 'INVALID-NAME=value vitest', 'TZ =UTC vitest', 'TZ=$ZONE vitest', 'cross-env NODE_OPTIONS="${NODE_OPTIONS} --no-warnings" vitest', 'TZ=$(date) vitest', 'vitest && build', 'npm run test:unit', 'vitest watch', 'vitest --config "$CONFIG"', 'react-scripts start', 'jest --config "missing quote'])('requires report import for %s rather than bypassing project setup', script => {
    const candidate = { ...project, scripts: { 'test:coverage': script, test: 'vitest' }, dependencies: [dependency('vitest')] }
    expect(selectCoverageScript(candidate.scripts)?.runner).toBeUndefined()
    expect(detectCoverageRunner(candidate)).toBe('report')
  })

  it.each(['nyc', 'c8', 'cypress', '@playwright/test', 'playwright', 'karma-coverage', '@web/test-runner'])('recognizes report import for %s', name => {
    const candidate = { ...project, dependencies: [dependency(name)] }
    expect(detectCoverageRunner(candidate)).toBe('report')
    expect(isCoverageProject(candidate)).toBe(true)
  })

  it('allows individual package imports without adding unknown setups to global scans', () => {
    expect(canInspectCoverage(project)).toBe(true)
    expect(isCoverageProject(project)).toBe(false)
    expect(isCoverageProject({ ...project, scripts: { test: 'node custom-tests.js' } })).toBe(false)
    expect(canInspectCoverage({ scripts: {}, hasPackageJson: false })).toBe(false)
    expect(detectCoverageRunner({ ...project, scripts: { e2e: 'npx playwright test' } })).toBe('report')
    expect(detectCoverageRunner({ ...project, dependencies: [dependency('jest-dom')] })).toBeNull()
  })

  it('keeps saved reports eligible after dependencies change', () => {
    const candidate = { ...project, hasPackageJson: false, testCoverage: {} as RepoProject['testCoverage'] }
    expect(detectCoverageRunner(candidate)).toBe('report')
    expect(canInspectCoverage(candidate)).toBe(true)
  })
})

it('distinguishes absent and empty metrics from measured zero coverage', () => {
  expect(coveragePercent(null)).toBeNull()
  expect(formatCoveragePercent({ covered: 0, total: 0, pct: 100 })).toBe('—')
  expect(coverageLevel({ covered: 0, total: 0, pct: 100 })).toBe('unknown')
  expect(formatCoveragePercent({ covered: 0, total: 8, pct: 0 })).toBe('0%')
  expect(coverageLevel({ covered: 0, total: 8, pct: 0 })).toBe('poor')
  expect(formatCoveragePercent({ covered: 9999, total: 10000, pct: 99.99 })).toBe('99.99%')
  expect(coveragePercent({ covered: 0, total: 8, pct: NaN })).toBeNull()
})
