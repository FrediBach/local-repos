import { describe, expect, it } from 'vitest'
import { isReactProject, reactDoctorScoreLevel } from './react-doctor'
import type { ProjectDependency } from '../types'

describe('React Doctor eligibility', () => {
  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const)('recognizes React in %s', kind => {
    const dependencies: ProjectDependency[] = [{ name: 'react', version: '^19', kind }]
    expect(isReactProject({ dependencies, stack: [] })).toBe(true)
  })

  it('recognizes React frameworks and cached technology metadata without matching tool names', () => {
    expect(isReactProject({ dependencies: [{ name: 'react-native', version: '*', kind: 'dependencies' }], stack: [] })).toBe(true)
    expect(isReactProject({ stack: ['Next.js'] })).toBe(true)
    expect(isReactProject({ stack: ['React'] })).toBe(true)
    expect(isReactProject({ dependencies: [{ name: 'react-doctor', version: '*', kind: 'devDependencies' }], stack: ['Vue'] })).toBe(false)
    expect(isReactProject({ dependencies: [], stack: [] })).toBe(false)
  })
})

it('distinguishes unavailable and zero scores and uses React Doctor score boundaries', () => {
  expect(reactDoctorScoreLevel(null)).toBe('unknown')
  expect(reactDoctorScoreLevel(NaN)).toBe('unknown')
  expect(reactDoctorScoreLevel(0)).toBe('poor')
  expect(reactDoctorScoreLevel(49)).toBe('poor')
  expect(reactDoctorScoreLevel(50)).toBe('warning')
  expect(reactDoctorScoreLevel(74)).toBe('warning')
  expect(reactDoctorScoreLevel(75)).toBe('good')
  expect(reactDoctorScoreLevel(100)).toBe('good')
})
