import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function start(mode) {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  if (mode === 'app') {
    try {
      if (!statSync(new URL('../dist/index.html', import.meta.url)).isFile()) throw new Error('Missing build')
    } catch {
      console.error('No app build found. Run npm run build, then npm run app.')
      process.exitCode = 1
      return
    }
  }
  const viteArgs = mode === 'app' ? ['preview', '--port', '5180', '--strictPort'] : []
  const children = [
    spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...viteArgs, '--host', '127.0.0.1'], { cwd, stdio: 'inherit' }),
    spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd, stdio: 'inherit' }),
  ]
  let stopping = false
  function stop(code = 0) {
    if (stopping) return
    stopping = true
    process.exitCode = code
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const deadline = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 3000)
    deadline.unref()
  }
  for (const child of children) {
    child.once('error', error => { console.error(error.message); stop(1) })
    child.once('exit', code => stop(code ?? 1))
  }
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
}
