import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { freePort, ProjectRuntime } from './runtime'
import { ProjectRegistry, scanDirectory } from './scanner'

const exec = promisify(execFile)
let directory: string
let runtime: ProjectRuntime | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await runtime?.shutdown()
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function fixture(fixedPort?: number, holdBindError = false) {
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-repos-worktree-runtime-')))
  const main = path.join(directory, 'main')
  const linked = path.join(directory, 'linked')
  await mkdir(main)
  await writeFile(path.join(main, 'package.json'), JSON.stringify({ name: 'same-name', scripts: { dev: 'node dev.cjs' } }))
  await writeFile(path.join(main, 'dev.cjs'), `
    const port = ${fixedPort ?? 'Number(process.env.PORT)'}
    const server = require('node:http').createServer((req, res) => res.end(process.cwd()))
    ${holdBindError ? "server.on('error', () => setInterval(() => {}, 1000))" : ''}
    console.log('http://127.0.0.1:' + port)
    server.listen(port, '127.0.0.1')
  `)
  const git = (...args: string[]) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: main })
  await git('init', '-b', 'main')
  await git('add', '.')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture')
  await git('worktree', 'add', '-b', 'linked', linked)
  const { registered } = await scanDirectory(directory)
  const registry = new ProjectRegistry()
  registry.register(registered)
  runtime = new ProjectRuntime(registry)
  return { main: registered.find(entry => entry.directory === main)!, linked: registered.find(entry => entry.directory === linked)! }
}

describe('worktree process ownership', () => {
  it('runs sibling checkouts on distinct ports and stops only the selected checkout', async () => {
    const { main, linked } = await fixture()
    const [first, second] = await Promise.all([runtime!.start(main.project.id), runtime!.start(linked.project.id)])
    expect(first.status).toBe('running')
    expect(second.status).toBe('running')
    expect(first.url).not.toBe(second.url)
    expect(await (await fetch(first.url!)).text()).toBe(main.directory)
    expect(await (await fetch(second.url!)).text()).toBe(linked.directory)
    await runtime!.stop(linked.project.id)
    expect(await (await fetch(first.url!)).text()).toBe(main.directory)
  }, 20_000)

  it('never treats an already running sibling on a logged fixed port as ready', async () => {
    const { main, linked } = await fixture(await freePort())
    const first = await runtime!.start(main.project.id)
    expect(first.status).toBe('running')
    const second = await runtime!.start(linked.project.id)
    expect(second.status).toBe('error')
    expect(second.url).toBeUndefined()
    expect(await (await fetch(first.url!)).text()).toBe(main.directory)
  }, 20_000)

  it('does not disclose the other project path in a fixed-port failure', async () => {
    const { main, linked } = await fixture(await freePort(), true)
    expect((await runtime!.start(main.project.id)).status).toBe('running')
    const second = await runtime!.start(linked.project.id)
    expect(second).toMatchObject({ status: 'error', error: expect.stringContaining('already used by another project') })
    expect(second.error).not.toContain(main.project.relativePath)
  }, 20_000)

  it('waits for sibling readiness before a competing fixed port can be claimed from delayed logs', async () => {
    const port = await freePort()
    const { main, linked } = await fixture(port, true)
    await writeFile(path.join(main.directory, 'dev.cjs'), `
      const server = require('node:http').createServer((req, res) => res.end(process.cwd()))
      server.listen(${port}, '127.0.0.1', () => setTimeout(() => console.log('http://127.0.0.1:${port}'), 750))
    `)
    const [first, second] = await Promise.all([runtime!.start(main.project.id), runtime!.start(linked.project.id)])
    expect(first.status).toBe('running')
    expect(second.status).toBe('error')
    expect(second.url).toBeUndefined()
    expect(await (await fetch(first.url!)).text()).toBe(main.directory)
  }, 20_000)

  it('cancels a sibling waiting for startup readiness without spawning it', async () => {
    const { main, linked } = await fixture()
    await writeFile(path.join(main.directory, 'dev.cjs'), `
      const port = Number(process.env.PORT)
      setTimeout(() => require('node:http').createServer((req, res) => res.end(process.cwd()))
        .listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port)), 500)
    `)
    await writeFile(path.join(linked.directory, 'dev.cjs'), `require('node:fs').writeFileSync('spawned.txt', 'unexpected')`)
    const first = runtime!.start(main.project.id)
    const waiting = runtime!.start(linked.project.id)
    await runtime!.stop(linked.project.id)
    expect((await first).status).toBe('running')
    expect((await waiting).status).toBe('stopped')
    await expect(stat(path.join(linked.directory, 'spawned.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await runtime!.logs(linked.project.id)).toBe('')
  }, 20_000)

  it('does not overwrite a replacement startup when port-conflict cleanup finishes late', async () => {
    const { main, linked } = await fixture(await freePort(), true)
    expect((await runtime!.start(main.project.id)).status).toBe('running')
    let observedStop!: () => void
    let finishCleanup!: () => void
    const stopped = new Promise<void>(resolve => { observedStop = resolve })
    const cleanup = new Promise<void>(resolve => { finishCleanup = resolve })
    const stop = runtime!.stop.bind(runtime)
    vi.spyOn(runtime!, 'stop').mockImplementationOnce(async (id, generation) => {
      const result = await stop(id, generation)
      observedStop()
      await cleanup
      return result
    })
    const firstAttempt = runtime!.start(linked.project.id)
    try {
      await stopped
      await writeFile(path.join(linked.directory, 'replacement.cjs'), `
        const port = Number(process.env.PORT)
        const server = require('node:http').createServer((req, res) => res.end(process.cwd()))
        server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port))
      `)
      linked.project.scripts = { dev: 'node replacement.cjs' }
      await writeFile(path.join(linked.directory, 'package.json'), JSON.stringify({ name: 'replacement', scripts: linked.project.scripts }))
      const replacement = await runtime!.start(linked.project.id)
      expect(replacement.status).toBe('running')
      finishCleanup()
      await firstAttempt
      expect(await runtime!.status(linked.project.id)).toEqual(replacement)
      expect(await (await fetch(replacement.url!)).text()).toBe(linked.directory)
    } finally { finishCleanup(); await firstAttempt }
  }, 20_000)
})
