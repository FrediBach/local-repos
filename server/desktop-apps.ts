import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopAppName, desktopApps, desktopPlatforms, type DesktopAppId } from '../src/lib/desktop-apps'
import type { OpenProjectRequest } from '../src/types'
import { HelperError } from './scanner'

const execFileAsync = promisify(execFile)
interface Launcher {
  mac?: string
  linux?: string
  windows?: string
  args?: string[]
}

// Only these fixed executables and flags can be selected by a request. Paths
// always come from ProjectRegistry.get(), never from the request body.
const launchers: Record<DesktopAppId, Launcher> = {
  vscode: { mac: 'Visual Studio Code', linux: 'code', windows: 'Code.exe' },
  'vscode-insiders': { mac: 'Visual Studio Code - Insiders', linux: 'code-insiders', windows: 'Code - Insiders.exe' },
  vscodium: { mac: 'VSCodium', linux: 'codium', windows: 'VSCodium.exe' },
  cursor: { mac: 'Cursor', linux: 'cursor', windows: 'Cursor.exe' },
  windsurf: { mac: 'Windsurf', linux: 'windsurf', windows: 'Windsurf.exe' },
  zed: { mac: 'Zed', linux: 'zed', windows: 'zed.exe' },
  'sublime-text': { mac: 'Sublime Text', linux: 'subl', windows: 'sublime_text.exe' },
  webstorm: { mac: 'WebStorm', linux: 'webstorm', windows: 'webstorm64.exe' },
  'intellij-idea': { mac: 'IntelliJ IDEA', linux: 'idea', windows: 'idea64.exe' },
  pycharm: { mac: 'PyCharm', linux: 'pycharm', windows: 'pycharm64.exe' },
  phpstorm: { mac: 'PhpStorm', linux: 'phpstorm', windows: 'phpstorm64.exe' },
  rider: { mac: 'Rider', linux: 'rider', windows: 'rider64.exe' },
  goland: { mac: 'GoLand', linux: 'goland', windows: 'goland64.exe' },
  clion: { mac: 'CLion', linux: 'clion', windows: 'clion64.exe' },
  rubymine: { mac: 'RubyMine', linux: 'rubymine', windows: 'rubymine64.exe' },
  rustrover: { mac: 'RustRover', linux: 'rustrover', windows: 'rustrover64.exe' },
  'android-studio': { mac: 'Android Studio', linux: 'studio', windows: 'studio64.exe' },
  xcode: { mac: 'Xcode' },
  nova: { mac: 'Nova' },
  bbedit: { mac: 'BBEdit' },
  'notepad-plus-plus': { windows: 'notepad++.exe', args: ['-openFoldersAsWorkspace'] },
  'visual-studio': { windows: 'devenv.exe' },
  sourcetree: { mac: 'Sourcetree', windows: 'SourceTree.exe', args: ['-f'] },
  fork: { mac: 'Fork', windows: 'Fork.exe' },
  'github-desktop': { mac: 'GitHub Desktop', windows: 'GitHubDesktop.exe', args: ['--cli-open'] },
  gitkraken: { mac: 'GitKraken', linux: 'gitkraken', windows: 'gitkraken.exe', args: ['-p'] },
  tower: { mac: 'Tower', windows: 'Tower.exe', args: ['-o'] },
  'sublime-merge': { mac: 'Sublime Merge', linux: 'smerge', windows: 'smerge.exe' },
  smartgit: { mac: 'SmartGit', linux: 'smartgit', windows: 'smartgit.exe', args: ['--open'] },
  'git-cola': { linux: 'git-cola', args: ['--repo'] },
  gitextensions: { windows: 'GitExtensions.exe', args: ['browse'] },
  tortoisegit: { windows: 'TortoiseGitProc.exe' },
}

export function desktopLaunchCommand(app: OpenProjectRequest['app'], directory: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (app === 'folder') {
    if (platform === 'darwin') return { command: '/usr/bin/open', args: [directory] }
    if (platform === 'linux') return { command: 'xdg-open', args: [directory] }
    if (platform === 'win32') return { command: 'explorer.exe', args: [directory] }
    throw new HelperError('Opening folders is supported on macOS, Linux, and Windows.', 501)
  }
  const launcher = launchers[app]
  const definition = desktopApps.find(item => item.id === app)!
  if (!(definition.platforms as readonly string[]).includes(platform)) {
    throw new HelperError(`Opening ${definition.name} is supported on ${definition.platforms.map(value => desktopPlatforms[value]).join(' and ')}. Choose another application in Settings → Applications.`, 501)
  }
  if (platform === 'darwin') {
    // GitKraken consumes CLI flags rather than macOS document-open events.
    if (app === 'gitkraken') return { command: '/usr/bin/open', args: ['-n', '-a', launcher.mac!, '--args', '-p', directory] }
    return { command: '/usr/bin/open', args: ['-a', launcher.mac!, directory] }
  }
  const command = platform === 'win32' ? launcher.windows! : launcher.linux!
  if (app === 'tortoisegit') return { command, args: ['/command:log', `/path:${directory}`] }
  return { command, args: [...launcher.args ?? [], directory] }
}

export async function openDesktopApp(app: OpenProjectRequest['app'], directory: string, platform = process.platform): Promise<void> {
  const { command, args } = desktopLaunchCommand(app, directory, platform)
  try {
    if (platform === 'darwin') {
      await execFileAsync(command, args, { timeout: 10_000, maxBuffer: 64 * 1024, shell: false })
    } else {
      // Desktop applications, like script terminals, belong to the user. Do
      // not kill them after a request timeout or when the helper shuts down.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    }
  } catch {
    const name = app === 'folder' ? 'the file browser' : desktopAppName(app)
    const setup = platform === 'darwin' ? 'Make sure it is installed on this computer.' : `Make sure ${command} is installed and available on the helper's PATH, then restart the helper.`
    throw new HelperError(`Could not open ${name}. ${setup}`)
  }
}
