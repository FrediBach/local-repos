import { describe, expect, it } from 'vitest'
import { groupProjectResults } from './project-groups'
import type { RepoProject } from '@/types'

const standalone: RepoProject = { id: 'solo', name: 'Solo', dirName: 'solo', relativePath: 'solo', description: '', stack: [], scripts: {}, packageManager: 'npm', scannedAt: '' }
const root: RepoProject = { ...standalone, id: 'suite', name: 'Suite', relativePath: 'suite', workspacePackageCount: 2 }
const member = (id: string, parent = root): RepoProject => ({ ...standalone, id, name: id, relativePath: `${parent.relativePath}/${id}`, monorepo: { id: parent.id, name: parent.name, relativePath: parent.relativePath, packagePath: id } })

describe('project result grouping', () => {
  it('positions each monorepo at its first sorted project and keeps the input order within it', () => {
    const web = member('web')
    const api = member('api')
    const projects = [web, standalone, root, api]
    const groups = groupProjectResults(projects)
    expect(groups.map(group => group.items.map(item => item.project.id))).toEqual([['web', 'suite', 'api'], ['solo']])
    expect(groups[0].items.map(item => item.index)).toEqual([0, 2, 3])
    expect(groups[0].monorepo).toMatchObject({ id: 'suite', name: 'Suite', relativePath: 'suite' })
    expect(groups[1].monorepo).toBeUndefined()
    expect(projects).toEqual([web, standalone, root, api])
  })

  it('keeps filtered members grouped without adding their hidden root or siblings', () => {
    const web = member('web')
    const groups = groupProjectResults([standalone, web])
    expect(groups.map(group => group.items.map(item => item.project.id))).toEqual([['solo'], ['web']])
    expect(groups[1].monorepo?.id).toBe(root.id)
    expect(groupProjectResults([root])[0].monorepo?.id).toBe(root.id)
  })

  it('groups by repository identity even when two monorepos have the same name', () => {
    const otherRoot = { ...root, id: 'other-suite', relativePath: 'other-suite' }
    const groups = groupProjectResults([member('web'), member('site', otherRoot), member('api'), otherRoot])
    expect(groups.map(group => group.items.map(item => item.project.id))).toEqual([['web', 'api'], ['site', 'other-suite']])
    expect(groups.map(group => group.monorepo?.relativePath)).toEqual(['suite', 'other-suite'])
  })

  it('includes a visible root once even if it has no cached package count', () => {
    const groups = groupProjectResults([{ ...root, workspacePackageCount: undefined }, member('web')])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map(item => item.project.id)).toEqual(['suite', 'web'])
  })

  it('joins nested workspace projects to their outer monorepo without duplicating intermediate roots', () => {
    const nested = { ...member('frontend'), workspacePackageCount: 1 }
    const web = member('web', nested)
    const groups = groupProjectResults([web, standalone, nested, root])
    expect(groups.map(group => group.items.map(item => item.project.id))).toEqual([['web', 'frontend', 'suite'], ['solo']])
    expect(groups[0].monorepo?.id).toBe(root.id)
  })

  it('uses hidden ancestor metadata to group nested matches without adding hidden projects', () => {
    const nested = { ...member('frontend'), workspacePackageCount: 1 }
    const web = member('web', nested)
    const groups = groupProjectResults([web], [root, nested, web])
    expect(groups).toHaveLength(1)
    expect(groups[0].monorepo?.id).toBe(root.id)
    expect(groups[0].items.map(item => item.project.id)).toEqual(['web'])
    expect(groupProjectResults([web])[0].monorepo?.id).toBe(nested.id)
  })
})
