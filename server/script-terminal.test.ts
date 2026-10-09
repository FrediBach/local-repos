import { terminals } from '../src/lib/desktop-apps'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegisteredProject } from './scanner'
import { openScriptTerminal, terminalLaunchCommands, terminalScriptCommand } from './project-scripts'

const processMocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => processMocks)
const entry: RegisteredProject = { root: '/projects', directory: '/projects/a "quoted" project', project: { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: '.', description: '', stack: [], scripts: { test: 'vitest run' }, packageManager: 'pnpm', scannedAt: '' } }
beforeEach(() => { vi.resetAllMocks() })

describe('external terminal handoff', () => {
  it('passes the command as an AppleScript argument without injecting it into the program', async () => {
    processMocks.execFile.mockImplementation((_file, _args, _options, callback) => { callback(null, '', ''); return new EventEmitter() })
    await openScriptTerminal(entry, 'test', 'auto', 'darwin')
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
    await expect(openScriptTerminal(entry, 'test', 'auto', 'darwin')).rejects.toThrow('Could not open a terminal')
  })

  it('tries an available Linux terminal and keeps a shell open after the task finishes', async () => {
    const children: (EventEmitter & { unref: ReturnType<typeof vi.fn> })[] = []
    processMocks.spawn.mockImplementation((command) => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
      children.push(child)
      queueMicrotask(() => command === 'x-terminal-emulator' ? child.emit('error', Object.assign(new Error('Missing'), { code: 'ENOENT' })) : child.emit('spawn'))
      return child
    })
    await openScriptTerminal(entry, 'test', 'auto', 'linux')
    expect(processMocks.spawn).toHaveBeenNthCalledWith(2, 'gnome-terminal', ['--', '/bin/sh', '-c', `${terminalScriptCommand(entry, 'test')}\nexec /bin/sh -i`], { detached: true, stdio: 'ignore', shell: false })
    expect(children[1].unref).toHaveBeenCalledOnce()
  })

  it('gives a copy-command fallback when no Linux terminal is installed', async () => {
    processMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', Object.assign(new Error('Missing'), { code: 'ENOENT' })))
      return child
    })
    await expect(openScriptTerminal(entry, 'test', 'auto', 'linux')).rejects.toThrow('copy the script command')
    expect(processMocks.spawn).toHaveBeenCalledTimes(4)
  })

  it('reports unsupported platforms without launching anything', async () => {
    await expect(openScriptTerminal(entry, 'test', 'auto', 'win32')).rejects.toMatchObject({ status: 501 })
    expect(processMocks.spawn).not.toHaveBeenCalled()
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
})


describe('configured terminal launchers', () => {
  it('provides a launcher for every advertised platform and rejects other platforms', () => {
    for (const terminal of terminals) {
      for (const platform of ['darwin', 'linux', 'win32'] as const) {
        if ((terminal.platforms as readonly string[]).includes(platform)) {
          const launches = terminalLaunchCommands(entry, 'test', terminal.id, platform)
          expect(launches.length).toBeGreaterThan(0)
          expect(launches.every(launch => launch.command && launch.args.every(arg => typeof arg === 'string'))).toBe(true)
        } else expect(() => terminalLaunchCommands(entry, 'test', terminal.id, platform)).toThrow('platform')
      }
    }
  })

  it('uses iTerm2 automation with project values only in the command argument', async () => {
    processMocks.execFile.mockImplementation((_file, _args, _options, callback) => { callback(null, '', ''); return new EventEmitter() })
    await openScriptTerminal(entry, 'test', 'iterm2', 'darwin')
    const [, args, options] = processMocks.execFile.mock.calls[0]
    expect(args[1]).toContain('tell application "iTerm2"')
    expect(args[1]).toContain('create window with default profile')
    expect(args[1]).not.toContain(entry.directory)
    expect(args[2]).toBe(terminalScriptCommand(entry, 'test'))
    expect(options).toMatchObject({ shell: false, timeout: 10_000 })
  })

  it('launches macOS CLI applications in a new instance and retains the shell argument', () => {
    const launch = terminalLaunchCommands(entry, 'test', 'ghostty', 'darwin')[0]
    expect(launch).toEqual({ command: '/usr/bin/open', args: ['-n', '-a', 'Ghostty', '--args', '-e', '/bin/sh', '-c', `${terminalScriptCommand(entry, 'test')}\nexec /bin/sh -i`], bounded: true })
    expect(terminalLaunchCommands(entry, 'test', 'wezterm', 'linux')[0].args.slice(0, 3)).toEqual(['start', '--always-new-process', '--'])
  })

  it('does not silently switch apps when the selected terminal is missing', async () => {
    processMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', Object.assign(new Error('Missing'), { code: 'ENOENT' })))
      return child
    })
    await expect(openScriptTerminal(entry, 'test', 'kitty', 'linux')).rejects.toThrow('Could not open kitty')
    expect(processMocks.spawn).toHaveBeenCalledOnce()
    expect(processMocks.spawn.mock.calls[0][0]).toBe('kitty')
  })
})
