import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopApps, desktopPlatforms } from '../src/lib/desktop-apps'
import { desktopLaunchCommand, openDesktopApp } from './desktop-apps'

const processes = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), ...processes }))

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('desktop application launching', () => {
  const directory = '/projects/a repo\'s $(touch injected); `echo bad`'

  it('has a launcher for each advertised platform and rejects other platforms', () => {
    for (const app of desktopApps) {
      for (const platform of Object.keys(desktopPlatforms) as (keyof typeof desktopPlatforms)[]) {
        if ((app.platforms as readonly string[]).includes(platform)) {
          const launch = desktopLaunchCommand(app.id, directory, platform)
          expect(launch.command).toBeTruthy()
          expect(launch.args).not.toContain(undefined)
          expect(launch.args.filter(arg => arg.includes(directory))).toHaveLength(1)
          expect(launch.args.at(-1)).toBe(app.id === 'tortoisegit' ? `/path:${directory}` : directory)
        } else {
          expect(() => desktopLaunchCommand(app.id, directory, platform)).toThrow('Choose another application')
        }
      }
    }
    expect(() => desktopLaunchCommand('vscode', directory, 'freebsd')).toThrow()
    expect(() => desktopLaunchCommand('folder', directory, 'freebsd')).toThrow()
  })

  it('uses application-specific flags and preserves the complete path as one argument', () => {
    expect(desktopLaunchCommand('cursor', directory, 'darwin')).toEqual({ command: '/usr/bin/open', args: ['-a', 'Cursor', directory] })
    expect(desktopLaunchCommand('gitkraken', directory, 'darwin')).toEqual({ command: '/usr/bin/open', args: ['-n', '-a', 'GitKraken', '--args', '-p', directory] })
    expect(desktopLaunchCommand('gitkraken', directory, 'linux')).toEqual({ command: 'gitkraken', args: ['-p', directory] })
    expect(desktopLaunchCommand('smartgit', directory, 'linux')).toEqual({ command: 'smartgit', args: ['--open', directory] })
    expect(desktopLaunchCommand('vscode', directory, 'win32')).toEqual({ command: 'Code.exe', args: [directory] })
    expect(desktopLaunchCommand('sourcetree', directory, 'win32')).toEqual({ command: 'SourceTree.exe', args: ['-f', directory] })
    expect(desktopLaunchCommand('tower', directory, 'win32')).toEqual({ command: 'Tower.exe', args: ['-o', directory] })
    expect(desktopLaunchCommand('github-desktop', directory, 'win32')).toEqual({ command: 'GitHubDesktop.exe', args: ['--cli-open', directory] })
    expect(desktopLaunchCommand('gitextensions', directory, 'win32')).toEqual({ command: 'GitExtensions.exe', args: ['browse', directory] })
    expect(desktopLaunchCommand('notepad-plus-plus', directory, 'win32')).toEqual({ command: 'notepad++.exe', args: ['-openFoldersAsWorkspace', directory] })
    expect(desktopLaunchCommand('visual-studio', directory, 'win32')).toEqual({ command: 'devenv.exe', args: [directory] })
    expect(desktopLaunchCommand('folder', directory, 'linux')).toEqual({ command: 'xdg-open', args: [directory] })
  })

  it('bounds the macOS launcher without invoking a shell and reports a missing application', async () => {
    processes.execFile.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''))
    await openDesktopApp('fork', directory, 'darwin')
    expect(processes.execFile).toHaveBeenCalledWith('/usr/bin/open', ['-a', 'Fork', directory], { timeout: 10_000, maxBuffer: 64 * 1024, shell: false }, expect.any(Function))
    processes.execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error('not installed')))
    await expect(openDesktopApp('fork', directory, 'darwin')).rejects.toThrow('Could not open Fork. Make sure it is installed')
    expect(processes.spawn).not.toHaveBeenCalled()
  })

  it('detaches desktop applications after spawning and exposes launch errors', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    processes.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child })
    await openDesktopApp('zed', directory, 'linux')
    expect(processes.spawn).toHaveBeenCalledWith('zed', [directory], { detached: true, stdio: 'ignore', shell: false })
    expect(child.unref).toHaveBeenCalledOnce()
    processes.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child })
    await expect(openDesktopApp('zed', directory, 'linux')).rejects.toThrow('zed is installed and available on the helper\'s PATH')
  })
})
