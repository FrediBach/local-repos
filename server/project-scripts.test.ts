import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RegisteredProject } from './scanner'
import { terminalScriptCommand, validateProjectScript } from './project-scripts'

let root: string
let entry: RegisteredProject
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'local-repos-scripts-'))
  const directory = path.join(root, 'a project\'s $(echo injected) `echo bad`')
  await mkdir(directory)
  entry = { directory, root, project: { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: { test: 'vitest run', 'generate:component': 'plop component', prepare: 'husky' }, packageManager: 'npm', scannedAt: '' } }
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(entry.project))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('terminal script validation', () => {
  it('accepts a declared script without executing its command', async () => {
    expect(await validateProjectScript(entry, 'generate:component', 'plop component')).toBe('generate:component')
  })

  it('rejects arbitrary commands, inherited properties, hooks, and missing names', async () => {
    for (const [name, command] of [['unknown', 'echo unsafe'], ['toString', 'echo unsafe'], ['prepare', 'husky'], ['test', 'echo unsafe'], [undefined, undefined]]) {
      await expect(validateProjectScript(entry, name, command)).rejects.toThrow()
    }
  })

  it('rejects scripts changed or removed since scanning', async () => {
    await writeFile(path.join(entry.directory, 'package.json'), JSON.stringify({ scripts: { test: 'node changed.js' } }))
    await expect(validateProjectScript(entry, 'test', 'vitest run')).rejects.toMatchObject({ status: 409 })
    await expect(validateProjectScript(entry, 'generate:component', 'plop component')).rejects.toMatchObject({ status: 409 })
  })

  it('rejects symlinked manifests', async () => {
    const manifest = path.join(entry.directory, 'package.json')
    await rm(manifest)
    const target = path.join(root, 'outside.json')
    await writeFile(target, JSON.stringify(entry.project))
    await symlink(target, manifest)
    await expect(validateProjectScript(entry, 'test', 'vitest run')).rejects.toThrow('regular, readable package.json')
  })

  it('preserves literal paths, script names, and PATH when interpreted by a shell', async () => {
    const bin = path.join(root, 'bin')
    await mkdir(bin)
    await writeFile(path.join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n', { mode: 0o755 })
    const name = 'a test\'s $(echo injected); `echo bad`'
    const command = terminalScriptCommand(entry, name, bin)
    const { stdout } = await promisify(execFile)('/bin/sh', ['-c', command])
    expect(stdout).toBe(`${entry.directory}\nrun\n${name}\n`)
    expect(command).not.toContain('vitest')
  })
})
