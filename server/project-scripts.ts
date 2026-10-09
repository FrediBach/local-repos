import { execFile, spawn } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { discoverProjectScripts, scriptRunCommand } from '../src/lib/project-scripts'
import { terminals, type TerminalId } from '../src/lib/desktop-apps'
import { parsePackageJson } from '../src/lib/metadata'
import { HelperError, type RegisteredProject } from './scanner'

const execFileAsync = promisify(execFile)
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

export async function validateProjectScript(entry: RegisteredProject, name: unknown, command: unknown): Promise<string> {
  if (typeof name !== 'string' || typeof command !== 'string') throw new HelperError('Choose a script from this project.')
  const selected = discoverProjectScripts(entry.project).find(script => script.name === name)
  if (!selected || selected.command !== command) throw new HelperError('This script changed or is unavailable. Resync the project before running it.', 409)
  // Execute only a reviewed script in the current manifest, never a command
  // supplied by the browser or a stale cached script after an edit.
  let current: ReturnType<typeof parsePackageJson>
  try {
    const filename = path.join(entry.directory, 'package.json')
    const info = await lstat(filename)
    if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid manifest')
    current = parsePackageJson(await readFile(filename, 'utf8'))
  } catch { throw new HelperError('This project needs a regular, readable package.json file. Resync and try again.') }
  if (!discoverProjectScripts(current).some(script => script.name === name && script.command === command)) throw new HelperError('This script changed or is unavailable. Resync the project before running it.', 409)
  return selected.name
}

/** Quote all project-controlled values. The script body is never interpolated;
 * the package manager resolves it by its validated name. */
export function terminalScriptCommand(entry: RegisteredProject, name: string, executablePath = process.env.PATH): string {
  return `cd -- ${quote(entry.directory)} && ${executablePath ? `env PATH=${quote(executablePath)} ` : ''}${scriptRunCommand(entry.project.packageManager, name)}`
}

async function spawnTerminal(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

interface TerminalLaunch { command: string; args: string[]; bounded?: boolean }

/** Fixed launchers only; project-controlled shell text travels in arguments. */
export function terminalLaunchCommands(entry: RegisteredProject, name: string, terminal: TerminalId, platform: NodeJS.Platform): TerminalLaunch[] {
  const definition = terminals.find(app => app.id === terminal)
  if (!definition) throw new HelperError('Choose a supported script terminal in Settings → Applications.')
  if (!(definition.platforms as readonly string[]).includes(platform)) throw new HelperError(`${definition.name} cannot launch scripts on this platform. Choose a compatible terminal in Settings → Applications, or copy the script command.`, 501)
  const command = terminalScriptCommand(entry, name)
  const shell = ['/bin/sh', '-c', `${command}\nexec /bin/sh -i`]
  const selected = terminal === 'auto' && platform === 'darwin' ? 'terminal' : terminal
  if (selected === 'terminal' || selected === 'iterm2') {
    const source = selected === 'terminal'
      ? 'on run argv\n tell application "Terminal"\n activate\n do script (item 1 of argv)\n end tell\nend run'
      : 'on run argv\n tell application "iTerm2"\n activate\n set newWindow to (create window with default profile)\n tell current session of newWindow to write text (item 1 of argv)\n end tell\nend run'
    return [{ command: '/usr/bin/osascript', args: ['-e', source, command], bounded: true }]
  }
  if (selected === 'auto') return ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].map(binary => ({ command: binary, args: [binary === 'gnome-terminal' ? '--' : '-e', ...shell] }))
  const launchers: Partial<Record<TerminalId, { binary: string; mac?: string; args: string[] }>> = {
    ghostty: { binary: 'ghostty', mac: 'Ghostty', args: ['-e', ...shell] },
    kitty: { binary: 'kitty', mac: 'kitty', args: [...shell] },
    wezterm: { binary: 'wezterm', mac: 'WezTerm', args: ['start', '--always-new-process', '--', ...shell] },
    alacritty: { binary: 'alacritty', mac: 'Alacritty', args: ['-e', ...shell] },
    'gnome-terminal': { binary: 'gnome-terminal', args: ['--', ...shell] },
    konsole: { binary: 'konsole', args: ['--separate', '-e', ...shell] },
    'xfce4-terminal': { binary: 'xfce4-terminal', args: ['--disable-server', '-x', ...shell] },
    tilix: { binary: 'tilix', args: ['-e', ...shell] },
    terminator: { binary: 'terminator', args: ['-x', ...shell] },
    'mate-terminal': { binary: 'mate-terminal', args: ['-x', ...shell] },
    xterm: { binary: 'xterm', args: ['-e', ...shell] },
  }
  const launcher = launchers[selected]!
  if (platform === 'darwin') return [{ command: '/usr/bin/open', args: ['-n', '-a', launcher.mac!, '--args', ...launcher.args], bounded: true }]
  return [{ command: launcher.binary, args: launcher.args }]
}

export async function openScriptTerminal(entry: RegisteredProject, name: string, terminal: TerminalId = 'auto', platform = process.platform): Promise<void> {
  const launches = terminalLaunchCommands(entry, name, terminal, platform)
  for (const launch of launches) {
    try {
      if (launch.bounded) await execFileAsync(launch.command, launch.args, { timeout: 10_000, maxBuffer: 64 * 1024, shell: false })
      else await spawnTerminal(launch.command, launch.args)
      return
    } catch (error) {
      if (terminal !== 'auto' || (error as NodeJS.ErrnoException).code !== 'ENOENT') break
    }
  }
  const label = terminals.find(app => app.id === terminal)!.name
  const setup = platform === 'darwin'
    ? 'Make sure it is installed. For Terminal and iTerm2, allow the helper to control the app in macOS Automation settings.'
    : "Make sure its command-line launcher is installed on the helper's PATH, then restart the helper."
  throw new HelperError(`Could not open ${terminal === 'auto' ? 'a terminal' : label}. ${setup} Choose another terminal in Settings → Applications, or copy the script command.`)
}
