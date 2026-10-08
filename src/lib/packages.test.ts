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
    expect(packageMatches({}, 'react@19.*.*')).toEqual([])
  })

  it.each([
    ['16.2.1', ['16.2.1', '^16.0.0', '~16.2.0', '>=15', 'v16.2.1', '16.2.1+build.7'], ['16.2.10', '^16.3.0', '~16.1.0', '116.2.1', '16.2.1-canary.4']],
    ['16.*.*', ['16.0.0', '^16.2.1', '~16.2.1', '>=15', '>=16.0.0 <17', '^15.0.0 || ^16.0.0', '15.0.0 - 16.0.0', '*'], ['^15.0.0', '17.0.0', '<16', '>=17', '116.0.0', '16.2.1-canary.4']],
    ['16.2.*', ['16.2.0', '^16.0.0', '~16.2.1', '>=15'], ['16.3.0', '~16.1.0', '>=16.3.0']],
    ['16.*', ['16.2.1', '^16.0.0', '>=15'], ['15.2.1', '17.0.0']],
    ['16.x', ['16.2.1', '^16.0.0'], ['15.2.1', '17.0.0']],
    ['>=16 <17', ['16.2.1', '>=15'], ['15.2.1', '17.0.0', '^15 || ^17']],
    ['16.2.1-canary.4', ['16.2.1-canary.4', '^16.2.1-canary.0'], ['16.2.1', '^16.0.0', '>=15']],
    ['*', ['^16.2.1-canary.0', '>16.0.0', '*'], ['>=16.0.0-alpha <16.0.0', '>16.0.0 <16.0.1']],
    ['>=16.0.1-alpha <16.0.1', ['>16.0.0 <=16.0.1-beta', '>16.0.1-alpha <16.0.1-alpha.1'], ['16.*.*', '>=16.0.1']],
  ])('finds compatible declarations for next@%s', (range, compatible, incompatible) => {
    const declarations: ProjectDependency[] = [...compatible, ...incompatible].map(version => ({ name: 'next', version, kind: 'dependencies' }))
    expect(packageMatches({ dependencies: declarations }, ` NeXt @ ${range} `).map(({ version }) => version)).toEqual(compatible)
  })

  it('does not match non-semver declarations by version or treat missing declarations as any version', () => {
    const declarations: ProjectDependency[] = ['', ' ', 'latest', 'workspace:*', 'catalog:', 'file:../next-16.2.1', 'npm:next@16.2.1', 'git+https://example.test/next#v16.2.1']
      .map(version => ({ name: 'next', version, kind: 'dependencies' }))
    expect(packageMatches({ dependencies: declarations }, 'next@16.*.*')).toEqual([])
    expect(packageMatches({ dependencies: declarations }, 'next@*')).toEqual([])
    expect(packageMatches({ dependencies: declarations }, 'next')).toEqual(declarations)
  })

  it('uses an exact package name for version searches, including scoped packages and dependency groups', () => {
    expect(packageMatches({ dependencies }, 'react@19.*.*')).toEqual([dependencies[0], dependencies[2]])
    expect(packageMatches({ dependencies }, '  @TYPES/REACT @ 19.0.0  ')).toEqual([dependencies[1]])
    expect(packageMatches({ dependencies }, 'fsevents@2.3.*')).toEqual([dependencies[3]])
    expect(packageMatches({ dependencies }, 'act@19.*.*')).toEqual([])
    const peer: ProjectDependency = { name: 'react', version: '^19.0.0', kind: 'peerDependencies' }
    expect(packageMatches({ dependencies: [...dependencies, peer] }, 'react@19.0.0')).toEqual([dependencies[0], dependencies[2], peer])
  })

  it.each(['react@', 'react@ ', 'react@@19.0.0', '@19.0.0', '@types/react@', 'react@latest', 'react@19?0?0', 'react@19.[01].*', 'react@(19.*.*)'])('does not broaden incomplete or invalid query %s', query => {
    expect(packageMatches({ dependencies }, query)).toEqual([])
  })

  it('labels the four dependency groups', () => {
    expect(dependencies.map(({ kind }) => dependencyKindLabel(kind))).toEqual([
      'Dependency', 'Dev dependency', 'Peer dependency', 'Optional dependency',
    ])
  })
})
