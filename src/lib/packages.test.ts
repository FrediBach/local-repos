import { describe, expect, it } from 'vitest'
import type { ProjectDependency } from '../types'
import { dependencyKindLabel, packageMatches } from './packages'

const dependencies: ProjectDependency[] = [
  { name: 'react', version: '^19.0.0', kind: 'dependencies' },
  { name: '@types/react', version: '~19.0.0', kind: 'devDependencies' },
  { name: 'react', version: '>=18', kind: 'peerDependencies' },
  { name: 'fsevents', version: '2.3.3', kind: 'optionalDependencies' },
]

describe('package search', () => {
  it('matches scoped and unscoped package names case-insensitively while keeping declared versions and groups', () => {
    expect(packageMatches({ dependencies }, '  ReAcT  ')).toEqual(dependencies.slice(0, 3))
    expect(packageMatches({ dependencies }, '@types/')).toEqual([dependencies[1]])
    expect(packageMatches({ dependencies }, 'fsevents')).toEqual([dependencies[3]])
  })

  it('does not match version specs or return all packages for an empty query', () => {
    expect(packageMatches({ dependencies }, '19.0.0')).toEqual([])
    expect(packageMatches({ dependencies }, '')).toEqual([])
    expect(packageMatches({ dependencies }, '  ')).toEqual([])
    expect(packageMatches({ dependencies }, 'missing')).toEqual([])
  })

  it('handles older saved projects without dependency metadata', () => {
    expect(packageMatches({}, 'react')).toEqual([])
  })

  it('labels the four dependency groups', () => {
    expect(dependencies.map(({ kind }) => dependencyKindLabel(kind))).toEqual([
      'Dependency', 'Dev dependency', 'Peer dependency', 'Optional dependency',
    ])
  })
})
