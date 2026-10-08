import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegisteredProject } from './scanner'
import { openScriptTerminal, terminalScriptCommand } from './project-scripts'

const processMocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => processMocks)
const entry: RegisteredProject = { root: '/projects', directory: '/projects/a "quoted" project', project: { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: { test: 'vitest run' }, packageManager: 'pnpm', scannedAt: '' } }
beforeEach(() => { vi.resetAllMocks() })

describe('external terminal handoff', () => {
  it('passes the command as an AppleScript argument without injecting it into the program', async () => {
    processMocks.execFile.mockImplementation((_file, _args, _options, callback) => { callback(null, '', ''); return new EventEmitter() })
    await openScriptTerminal(entry, 'test', 'darwin')
    const [executable, args] = processMocks.execFile.mock.calls[0]
    expect(executable).toBe('/usr/bin/osascript')
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain('do script (item 1 of argv)')
    expect(args[1]).not.toContain(entry.directory)
    expect(args[2]).toBe(terminalScriptCommand(entry, 'test'))
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('reports a failed macOS terminal launch', async () => {
    processMocks.execFile.mockImplementation((_file, _args, _options, callback) => { callback(new Error('Denied')); return new EventEmitter() })
    await expect(openScriptTerminal(entry, 'test', 'darwin')).rejects.toThrow('Could not open Terminal')
  })

  it('tries an available Linux terminal and keeps a shell open after the task finishes', async () => {
    const children: (EventEmitter & { unref: ReturnType<typeof vi.fn> })[] = []
    processMocks.spawn.mockImplementation((command) => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
      children.push(child)
      queueMicrotask(() => command === 'x-terminal-emulator' ? child.emit('error', Object.assign(new Error('Missing'), { code: 'ENOENT' })) : child.emit('spawn'))
      return child
    })
    await openScriptTerminal(entry, 'test', 'linux')
    expect(processMocks.spawn).toHaveBeenNthCalledWith(2, 'gnome-terminal', ['--', '/bin/sh', '-c', `${terminalScriptCommand(entry, 'test')}\nexec /bin/sh -i`], { detached: true, stdio: 'ignore', shell: false })
    expect(children[1].unref).toHaveBeenCalledOnce()
  })

  it('gives a copy-command fallback when no Linux terminal is installed', async () => {
    processMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', Object.assign(new Error('Missing'), { code: 'ENOENT' })))
      return child
    })
    await expect(openScriptTerminal(entry, 'test', 'linux')).rejects.toThrow('copy the script command')
    expect(processMocks.spawn).toHaveBeenCalledTimes(4)
  })

  it('reports unsupported platforms without launching anything', async () => {
    await expect(openScriptTerminal(entry, 'test', 'win32')).rejects.toMatchObject({ status: 501 })
    expect(processMocks.spawn).not.toHaveBeenCalled()
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
})
