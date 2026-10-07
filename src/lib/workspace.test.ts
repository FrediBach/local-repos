import { describe, expect, it } from 'vitest'
import { preservePreviews } from './workspace'
import type { RepoProject, Workspace } from '../types'

const cachedPng = 'data:image/png;base64,aGVsbG8='

function project(id: string, screenshot?: string): RepoProject {
  return {
    id, name: 'project-' + id, dirName: id, relativePath: id,
    description: 'Project overview', stack: [], scripts: {}, packageManager: 'npm',
    scannedAt: '2026-10-07T10:00:00.000Z', screenshot,
  }
}

function workspace(projects: RepoProject[]): Workspace {
  return {
    rootName: 'Projects', rootPath: '/Users/ada/Projects', mode: 'helper',
    syncedAt: '2026-10-07T10:00:00.000Z', projects,
  }
}

describe('captured preview persistence', () => {
  it('retains cached PNG data when a rescan or helper restart loses its temporary screenshot', () => {
    const preview = { url: 'https://example.com/app', source: 'github' as const, capturedAt: '2026-10-07T10:00:00.000Z' }
    const previous = workspace([{ ...project('one', cachedPng), preview }])
    const rescanned = workspace([{ ...project('one'), version: '2.0.0', description: 'Updated from disk' }])

    const result = preservePreviews(rescanned, previous)
    expect(result.projects[0]).toMatchObject({
      id: 'one', screenshot: cachedPng, preview, version: '2.0.0', description: 'Updated from disk',
    })
    expect(rescanned.projects[0].screenshot).toBeUndefined()
    expect(previous.projects[0].description).toBe('Project overview')
  })

  it('keeps durable PNG data when the helper returns a temporary URL for the same project', () => {
    const previous = workspace([project('one', cachedPng)])
    const next = workspace([project('one', '/api/screenshots/one.png')])
    expect(preservePreviews(next, previous).projects[0].screenshot).toBe(cachedPng)
  })

  it('never assigns a removed project’s preview to another project', () => {
    const previous = workspace([project('old-id', cachedPng)])
    const next = workspace([{ ...project('new-id'), name: previous.projects[0].name }])
    const result = preservePreviews(next, previous)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].id).toBe('new-id')
    expect(result.projects[0].screenshot).toBeUndefined()
  })

  it('keeps fresh scan URLs when there is no durable cached image', () => {
    const fresh = '/api/screenshots/new.png'
    const next = workspace([project('one', fresh)])
    expect(preservePreviews(next).projects[0].screenshot).toBe(fresh)
    const previous = workspace([project('one', '/api/screenshots/expired.png')])
    expect(preservePreviews(next, previous).projects[0].screenshot).toBe(fresh)
  })
})
