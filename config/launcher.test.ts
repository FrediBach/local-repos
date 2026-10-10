import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
let directory: string
let child: ChildProcess | undefined
let output = ''
let exited: Promise<unknown[]>

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  if (exited) await exited
  if (directory) await rm(directory, { recursive: true, force: true })
  child = undefined
  output = ''
})

async function fixture(build = true, failingHelper = false) {
  directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-launcher-'))
  for (const name of ['scripts', 'server', 'node_modules/vite/bin', 'dist']) {
    await mkdir(path.join(directory, name), { recursive: true })
  }
  for (const name of ['start', 'app', 'dev']) {
    await copyFile(path.join(root, `scripts/${name}.mjs`), path.join(directory, `scripts/${name}.mjs`))
  }
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
  await symlink(path.join(root, 'node_modules/tsx'), path.join(directory, 'node_modules/tsx'), 'dir')
  if (build) await writeFile(path.join(directory, 'dist/index.html'), '<html>Built app</html>')
  const source = (name: string) => `
    import { writeFileSync } from 'node:fs'
    console.log('${name}:ready', JSON.stringify(process.argv.slice(2)))
    process.on('SIGTERM', () => {
      writeFileSync('${name}.stopped', 'yes')
      process.exit(0)
    })
    setInterval(() => {}, 1000)
  `
  await writeFile(path.join(directory, 'node_modules/vite/bin/vite.js'), source('ui'))
  await writeFile(path.join(directory, 'server/index.ts'), source('helper') + (failingHelper ? '\nsetTimeout(() => process.exit(7), 500)' : ''))
}

function launch(mode: 'app' | 'dev') {
  child = spawn(process.execPath, [path.join(directory, `scripts/${mode}.mjs`)], {
    cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout!.on('data', chunk => { output += chunk.toString() })
  child.stderr!.on('data', chunk => { output += chunk.toString() })
  exited = once(child, 'exit')
}

it('rejects a missing build before starting either process', async () => {
  await fixture(false)
  launch('app')
  expect((await exited)[0]).toBe(1)
  expect(output).toContain('npm run build')
  expect(output).not.toContain(':ready')
})

it.each(['app', 'dev'] as const)('starts %s from the checkout and stops both children on shutdown', async mode => {
  await fixture(mode === 'app')
  launch(mode)
  await expect.poll(() => output).toContain('helper:ready')
  await expect.poll(() => output).toContain('ui:ready')
  expect(output).toContain(mode === 'app'
    ? '["preview","--port","5180","--strictPort","--host","127.0.0.1"]'
    : '["--host","127.0.0.1"]')
  child!.kill('SIGINT')
  expect((await exited)[0]).toBe(0)
  expect(await readFile(path.join(directory, 'ui.stopped'), 'utf8')).toBe('yes')
  expect(await readFile(path.join(directory, 'helper.stopped'), 'utf8')).toBe('yes')
})

it('stops the UI and propagates a helper failure', async () => {
  await fixture(true, true)
  launch('app')
  expect((await exited)[0]).toBe(7)
  expect(await readFile(path.join(directory, 'ui.stopped'), 'utf8')).toBe('yes')
})
