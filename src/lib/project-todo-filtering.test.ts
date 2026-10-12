import { describe, expect, it } from 'vitest'
import { projectTodoFilterGroups, projectTodoResults } from './project-todo-filtering'
import type { ProjectTodo, ProjectTodoGroup } from './project-todos'
import type { RepoProject } from '../types'

const project: RepoProject = { id: 'alpha', name: 'Alpha', dirName: 'alpha', relativePath: 'apps/alpha', description: 'Workspace app', stack: ['React'], tags: ['Internal'], scripts: {}, scannedAt: '' }
const task: ProjectTodo = { id: 'alpha:security', projectId: 'alpha', kind: 'security', priority: 'critical', title: 'Fix vulnerabilities', description: 'Review affected dependencies', tab: 'vulnerabilities', scannedAt: '2026-10-09', findingKeys: [] }
const groups: ProjectTodoGroup[] = [
  { project, todos: [task, { ...task, id: 'alpha:outdated', kind: 'outdated', priority: 'high', title: 'Update dependencies', description: 'Significant version lag', scannedAt: '2026-10-11' }] },
  { project: { ...project, id: 'bravo', name: 'Bravo', dirName: 'bravo', relativePath: 'apps/bravo', tags: ['Public'] }, todos: [{ ...task, id: 'bravo:doctor', projectId: 'bravo', kind: 'react-doctor', priority: 'high', title: 'Fix React Doctor errors', scannedAt: '2026-10-10' }] },
]

describe('todo search, filters, and sorting', () => {
  it('matches case-insensitive words across task text and project metadata', () => {
    for (const query of ['  ALPHA   significant ', 'apps/alpha package updates', 'Internal React lag', 'workspace dependencies high']) {
      expect(projectTodoResults(groups, query, {}, 'priority').groups[0].todos.map(todo => todo.id)).toEqual(['alpha:outdated'])
    }
    expect(projectTodoResults(groups, 'public doctor', {}, 'priority').groups.map(group => group.project.id)).toEqual(['bravo'])
    expect(projectTodoResults(groups, 'unmatched', {}, 'priority').matching).toBe(0)
    expect(projectTodoResults(groups, '   ', {}, 'priority').matching).toBe(3)
  })

  it('combines groups with AND, selections with OR, and counts alternatives without the current facet', () => {
    const result = projectTodoResults(groups, '', { priority: ['high'], kind: ['security', 'outdated'] }, 'priority')
    expect(result.groups.flatMap(group => group.todos.map(todo => todo.id))).toEqual(['alpha:outdated'])
    expect(result.counts).toEqual({ project: { alpha: 1 }, kind: { outdated: 1, 'react-doctor': 1 }, priority: { critical: 1, high: 1 } })
    expect(projectTodoResults(groups, '', { project: ['alpha', 'bravo'], priority: ['high'] }, 'priority').matching).toBe(2)
    expect(projectTodoResults(groups, 'alpha', { project: ['bravo'] }, 'priority')).toMatchObject({ groups: [], counts: { project: { alpha: 2 } } })
  })

  it('orders groups and tasks by the chosen scan direction, with missing dates last and no input mutation', () => {
    const input = [...groups, { project: { ...project, id: 'unknown', name: 'Unknown' }, todos: [{ ...task, projectId: 'unknown', scannedAt: 'invalid' }] }]
    input[0] = { ...input[0], todos: [...input[0].todos, { ...task, id: 'unknown-scan', scannedAt: '' }] }
    const original = structuredClone(input)
    const newest = projectTodoResults(input, '', {}, 'newest').groups
    expect(newest.map(group => group.project.id)).toEqual(['alpha', 'bravo', 'unknown'])
    expect(newest[0].todos.map(todo => todo.id)).toEqual(['alpha:outdated', 'alpha:security', 'unknown-scan'])
    const oldest = projectTodoResults(input, '', {}, 'oldest').groups
    expect(oldest.map(group => group.project.id)).toEqual(['alpha', 'bravo', 'unknown'])
    expect(oldest[0].todos.map(todo => todo.id)).toEqual(['alpha:security', 'alpha:outdated', 'unknown-scan'])
    expect(input).toEqual(original)
  })

  it('sorts project names in both directions and prioritizes only the matching tasks', () => {
    expect(projectTodoResults(groups, '', {}, 'project').groups.map(group => group.project.id)).toEqual(['alpha', 'bravo'])
    expect(projectTodoResults(groups, '', {}, 'project-desc').groups.map(group => group.project.id)).toEqual(['bravo', 'alpha'])
    const input = [groups[0], { ...groups[1], todos: [{ ...groups[1].todos[0], kind: 'security' as const }] }]
    expect(projectTodoResults(input, '', {}, 'priority').groups.map(group => group.project.id)).toEqual(['alpha', 'bravo'])
    expect(projectTodoResults(input, '', { priority: ['high'] }, 'priority').groups.map(group => group.project.id)).toEqual(['bravo', 'alpha'])
    expect(projectTodoResults(groups, '', { priority: ['high'] }, 'oldest').groups.map(group => group.project.id)).toEqual(['bravo', 'alpha'])
  })

  it('keeps project identities separate and removed selections available to clear', () => {
    const options = projectTodoFilterGroups([project, { ...project, id: 'other', relativePath: 'packages/alpha' }], { project: ['removed'] })[0].options
    expect(options).toContainEqual({ value: 'alpha', label: 'Alpha · apps/alpha' })
    expect(options).toContainEqual({ value: 'other', label: 'Alpha · packages/alpha' })
    expect(options).toContainEqual({ value: 'removed', label: 'Unavailable project' })
  })
})
