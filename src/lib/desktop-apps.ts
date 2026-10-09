export const desktopPlatforms = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' } as const
export type DesktopPlatform = keyof typeof desktopPlatforms

const allPlatforms = ['darwin', 'linux', 'win32'] as const
const macWindows = ['darwin', 'win32'] as const

export const editors = [
  { id: 'vscode', name: 'VS Code', platforms: allPlatforms },
  { id: 'vscode-insiders', name: 'VS Code Insiders', platforms: allPlatforms },
  { id: 'vscodium', name: 'VSCodium', platforms: allPlatforms },
  { id: 'cursor', name: 'Cursor', platforms: allPlatforms },
  { id: 'windsurf', name: 'Windsurf', platforms: allPlatforms },
  { id: 'zed', name: 'Zed', platforms: allPlatforms },
  { id: 'sublime-text', name: 'Sublime Text', platforms: allPlatforms },
  { id: 'webstorm', name: 'WebStorm', platforms: allPlatforms },
  { id: 'intellij-idea', name: 'IntelliJ IDEA', platforms: allPlatforms },
  { id: 'pycharm', name: 'PyCharm', platforms: allPlatforms },
  { id: 'phpstorm', name: 'PhpStorm', platforms: allPlatforms },
  { id: 'rider', name: 'Rider', platforms: allPlatforms },
  { id: 'goland', name: 'GoLand', platforms: allPlatforms },
  { id: 'clion', name: 'CLion', platforms: allPlatforms },
  { id: 'rubymine', name: 'RubyMine', platforms: allPlatforms },
  { id: 'rustrover', name: 'RustRover', platforms: allPlatforms },
  { id: 'android-studio', name: 'Android Studio', platforms: allPlatforms },
  { id: 'xcode', name: 'Xcode', platforms: ['darwin'] },
  { id: 'nova', name: 'Nova', platforms: ['darwin'] },
  { id: 'bbedit', name: 'BBEdit', platforms: ['darwin'] },
  { id: 'notepad-plus-plus', name: 'Notepad++', platforms: ['win32'] },
  { id: 'visual-studio', name: 'Visual Studio', platforms: ['win32'] },
] as const

export const gitClients = [
  { id: 'sourcetree', name: 'Sourcetree', platforms: macWindows },
  { id: 'fork', name: 'Fork', platforms: macWindows },
  { id: 'github-desktop', name: 'GitHub Desktop', platforms: macWindows },
  { id: 'gitkraken', name: 'GitKraken', platforms: allPlatforms },
  { id: 'tower', name: 'Tower', platforms: macWindows },
  { id: 'sublime-merge', name: 'Sublime Merge', platforms: allPlatforms },
  { id: 'smartgit', name: 'SmartGit', platforms: allPlatforms },
  { id: 'git-cola', name: 'Git Cola', platforms: ['linux'] },
  { id: 'gitextensions', name: 'Git Extensions', platforms: ['win32'] },
  { id: 'tortoisegit', name: 'TortoiseGit', platforms: ['win32'] },
] as const

export type EditorId = typeof editors[number]['id']
export type GitClientId = typeof gitClients[number]['id']
export type DesktopAppId = EditorId | GitClientId
export const desktopApps = [...editors, ...gitClients]
export const isEditorId = (value: unknown): value is EditorId => editors.some(app => app.id === value)
export const isGitClientId = (value: unknown): value is GitClientId => gitClients.some(app => app.id === value)
export const isDesktopAppId = (value: unknown): value is DesktopAppId => isEditorId(value) || isGitClientId(value)
export const desktopAppName = (id: DesktopAppId): string => desktopApps.find(app => app.id === id)!.name

// Script launchers currently support the same Unix platforms as script execution.
export const terminals = [
  { id: 'auto', name: 'Automatic', platforms: ['darwin', 'linux'] },
  { id: 'terminal', name: 'Terminal', platforms: ['darwin'] },
  { id: 'iterm2', name: 'iTerm2', platforms: ['darwin'] },
  { id: 'ghostty', name: 'Ghostty', platforms: ['darwin', 'linux'] },
  { id: 'kitty', name: 'kitty', platforms: ['darwin', 'linux'] },
  { id: 'wezterm', name: 'WezTerm', platforms: ['darwin', 'linux'] },
  { id: 'alacritty', name: 'Alacritty', platforms: ['darwin', 'linux'] },
  { id: 'gnome-terminal', name: 'GNOME Terminal', platforms: ['linux'] },
  { id: 'konsole', name: 'Konsole', platforms: ['linux'] },
  { id: 'xfce4-terminal', name: 'Xfce Terminal', platforms: ['linux'] },
  { id: 'tilix', name: 'Tilix', platforms: ['linux'] },
  { id: 'terminator', name: 'Terminator', platforms: ['linux'] },
  { id: 'mate-terminal', name: 'MATE Terminal', platforms: ['linux'] },
  { id: 'xterm', name: 'xterm', platforms: ['linux'] },
] as const
export type TerminalId = typeof terminals[number]['id']
export const isTerminalId = (value: unknown): value is TerminalId => terminals.some(app => app.id === value)
