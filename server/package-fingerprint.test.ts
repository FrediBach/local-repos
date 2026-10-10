import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { packageFingerprint } from './package-fingerprint'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'package-watch-'))) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('package input fingerprints', () => {
  it.each(['.trivyignore', '.trivignore'])('detects changes to %s', async name => {
    const before = await packageFingerprint(directory)
    await writeFile(path.join(directory, name), 'CVE-2026-12345')
    const created = await packageFingerprint(directory)
    expect(created).not.toBe(before)
    await writeFile(path.join(directory, name), 'CVE-2026-54321 # changed')
    expect(await packageFingerprint(directory)).not.toBe(created)
    await rm(path.join(directory, name))
    expect(await packageFingerprint(directory)).toBe(before)
  })

  it('detects manifest and lockfile creation, edits, atomic replacement, and deletion', async () => {
    const initial = await packageFingerprint(directory)
    await writeFile(path.join(directory, 'package.json'), '{"name":"first"}')
    const manifest = await packageFingerprint(directory)
    expect(manifest).not.toBe(initial)
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    const lock = await packageFingerprint(directory)
    expect(lock).not.toBe(manifest)
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 8')
    expect(await packageFingerprint(directory)).not.toBe(lock)
    await rm(path.join(directory, 'package.json'))
    await writeFile(path.join(directory, 'package.json'), '{"name":"first"}')
    expect(await packageFingerprint(directory)).not.toBe(manifest)
    await rm(path.join(directory, 'pnpm-lock.yaml'))
    expect(await packageFingerprint(directory)).not.toBe(lock)
  })

  it('ignores source files, dependencies and changes to symlink targets', async () => {
    await mkdir(path.join(directory, 'node_modules'))
    await writeFile(path.join(directory, 'outside.json'), '{}')
    await symlink(path.join(directory, 'outside.json'), path.join(directory, 'package.json'))
    const before = await packageFingerprint(directory)
    await writeFile(path.join(directory, 'index.ts'), 'changed')
    await writeFile(path.join(directory, 'node_modules/package.json'), 'changed')
    await writeFile(path.join(directory, 'outside.json'), '{"name":"changed"}')
    expect(await packageFingerprint(directory)).toBe(before)
    await symlink(directory, path.join(directory, 'linked'))
    expect(await packageFingerprint(path.join(directory, 'linked'))).toBe('missing')
    expect(await packageFingerprint(path.join(directory, 'deleted'))).toBe('missing')
  })
})
