import { execFile, spawn } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { discoverProjectScripts, scriptRunCommand } from '../src/lib/project-scripts'
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

export async function openScriptTerminal(entry: RegisteredProject, name: string, platform = process.platform): Promise<void> {
  const command = terminalScriptCommand(entry, name)
  if (platform === 'darwin') {
    try {
      // Pass shell text as an argument, never as AppleScript source.
      await execFileAsync('/usr/bin/osascript', ['-e', 'on run argv\n tell application "Terminal"\n activate\n do script (item 1 of argv)\n end tell\nend run', command], { timeout: 10_000 })
      return
    } catch { throw new HelperError('Could not open Terminal. Allow the local helper to control Terminal in macOS Automation settings, then try again.') }
  }
  if (platform === 'linux') {
    // Keep the terminal available after a one-shot script finishes or fails.
    const shell = ['/bin/sh', '-c', `${command}\nexec /bin/sh -i`]
    for (const [binary, flag] of [['x-terminal-emulator', '-e'], ['gnome-terminal', '--'], ['konsole', '-e'], ['xterm', '-e']]) {
      try { await spawnTerminal(binary, [flag, ...shell]); return }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break }
    }
    throw new HelperError('Could not open a terminal. Install x-terminal-emulator, GNOME Terminal, Konsole, or xterm, or copy the script command into your terminal.')
  }
  throw new HelperError('Opening script terminals is supported on macOS and Linux. Copy the script command into your terminal on this platform.', 501)
}
