import { describe, expect, it } from 'vitest'
import type { RepoProject } from '../src/types'
import { configuredServerUrls, devCommand, discoverServerUrls } from './dev-server'
import type { RegisteredProject } from './scanner'

function entry(command: string, name = 'dev', packageManager: RepoProject['packageManager'] = 'npm'): RegisteredProject {
  return { directory: '/projects/fixture', root: '/projects', project: { id: 'fixture', name: 'Fixture', dirName: 'fixture', relativePath: 'fixture', description: '', stack: [], scannedAt: '', packageManager, scripts: { [name]: command } } }
}

describe('framework startup adapters', () => {
  it.each([
    ['vite', ['--host', '127.0.0.1', '--port', '4567', '--strictPort']],
    ['vite dev', ['--host', '127.0.0.1', '--port', '4567', '--strictPort']],
    ['next dev --turbopack', ['--hostname', '127.0.0.1', '--port', '4567']],
    ['next start', ['--hostname', '127.0.0.1', '--port', '4567']],
    ['astro dev', ['--host', '127.0.0.1', '--port', '4567']],
    ['nuxt dev', ['--host', '127.0.0.1', '--port', '4567']],
    ['nuxi dev', ['--host', '127.0.0.1', '--port', '4567']],
    ['ng serve my-app', ['--host', '127.0.0.1', '--port', '4567']],
    ['vue-cli-service serve', ['--host', '127.0.0.1', '--port', '4567']],
    ['webpack serve --mode development', ['--host', '127.0.0.1', '--port', '4567']],
    ['webpack-dev-server', ['--host', '127.0.0.1', '--port', '4567']],
    ['parcel src/index.html', ['--host', '127.0.0.1', '--port', '4567']],
    ['parcel serve src/index.html', ['--host', '127.0.0.1', '--port', '4567']],
  ])('forwards supported host and port options to %s', (script, flags) => {
    expect(devCommand(entry(script), 4567)).toEqual({ command: 'npm', args: ['run', 'dev', '--', ...flags] })
  })

  it.each(['pnpm', 'yarn', 'bun'] as const)('forwards %s arguments without npm’s separator', (manager) => {
    expect(devCommand(entry('astro dev', 'start', manager), 4567)).toEqual({ command: manager, args: ['run', 'start', '--host', '127.0.0.1', '--port', '4567'] })
  })

  it('uses start and serve scripts and leaves React Scripts on its environment contract', () => {
    expect(devCommand(entry('react-scripts start', 'start'), 4567)).toEqual({ command: 'npm', args: ['run', 'start'] })
    expect(devCommand(entry('vue-cli-service serve', 'serve'), 4567).args).toEqual(['run', 'serve', '--', '--host', '127.0.0.1', '--port', '4567'])
  })

  it('recognizes simple environment wrappers and executable paths', () => {
    expect(devCommand(entry('cross-env NODE_ENV="development" ./node_modules/.bin/vite'), 4567).args).toEqual(['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4567', '--strictPort'])
    expect(devCommand(entry('NODE_ENV=development npx astro dev'), 4567).args).toContain('--host')
    expect(devCommand(entry('env NODE_ENV=development next dev'), 4567).args).toContain('--hostname')
  })

  it('preserves configured ports and hosts without conflicting duplicate options', () => {
    expect(devCommand(entry('vite --port=3001 --host localhost --strictPort'), 4567).args).toEqual(['run', 'dev'])
    expect(devCommand(entry('next dev -p3001 -H localhost'), 4567).args).toEqual(['run', 'dev'])
    expect(devCommand(entry('nuxt dev -p 3001 -h localhost'), 4567).args).toEqual(['run', 'dev'])
    expect(devCommand(entry('astro dev --host --port 3001'), 4567).args).toEqual(['run', 'dev'])
    expect(devCommand(entry('cross-env PORT=3001 next dev'), 4567).args).toEqual(['run', 'dev', '--', '--hostname', '127.0.0.1'])
    expect(devCommand(entry('cross-env NUXT_PORT=3001 NUXT_HOST=localhost nuxt dev'), 4567).args).toEqual(['run', 'dev'])
  })

  it.each([
    'node scripts/dev.mjs',
    'vite && node cleanup.js',
    'concurrently "vite" "node api.js"',
    'cross-env-shell "vite"',
    'echo vite',
    'next build',
    'parcel watch index.html',
    'webpack --watch',
    'vite -- --custom-flag',
    'vite > vite.log',
    'vite # a comment',
  ])('does not append framework flags to unsupported or compound scripts: %s', (script) => {
    expect(devCommand(entry(script), 4567).args).toEqual(['run', 'dev'])
  })

  it('keeps dynamic declared ports for log discovery and rejects unsupported startup', () => {
    expect(devCommand(entry('next dev --port $CUSTOM_PORT'), 4567).args).toEqual(['run', 'dev', '--', '--hostname', '127.0.0.1'])
    expect(() => devCommand(entry(''), 4567)).toThrow('dev script, start script, or serve script')
    expect(() => devCommand(entry('vite'), 4567, 'win32')).toThrow('Windows are not supported')
  })
})

describe('declared server addresses', () => {
  it('honors explicit ports, host aliases, base paths, and HTTPS', () => {
    expect(configuredServerUrls('vite --port=3001 --base /my-app/', 4567)).toEqual(['http://127.0.0.1:3001/my-app/'])
    expect(configuredServerUrls('ng serve --host localhost --port 4201 --serve-path /demo/ --ssl', 4567)).toEqual(['https://localhost:4201/demo/'])
    expect(configuredServerUrls('next dev -p3001 -H ::1 --experimental-https', 4567)).toEqual(['https://[::1]:3001/'])
    expect(configuredServerUrls('cross-env HTTPS=true PORT=3002 react-scripts start', 4567)).toEqual(['https://127.0.0.1:3002/'])
    expect(configuredServerUrls('cross-env NUXT_PORT=3001 PORT=3002 nuxt dev', 4567)).toEqual(['http://127.0.0.1:3001/'])
    expect(configuredServerUrls('PORT=3001 HOST=0.0.0.0 node dev.js', 4567)).toEqual(['http://127.0.0.1:3001/'])
  })

  it('uses the reserved port for supported frameworks without guessing framework defaults', () => {
    expect(configuredServerUrls('astro dev', 4567)).toEqual(['http://127.0.0.1:4567/'])
    expect(configuredServerUrls('node dev.js', 4567)).toEqual([])
    expect(configuredServerUrls('next dev --port $CUSTOM_PORT', 4567)).toEqual([])
    expect(configuredServerUrls('vite --port 0', 4567)).toEqual([])
    expect(configuredServerUrls('vite --port 99999', 4567)).toEqual([])
  })

  it('does not infer addresses from compound scripts or nonlocal hosts', () => {
    expect(configuredServerUrls('PORT=3001 node api.js & vite', 4567)).toEqual([])
    expect(configuredServerUrls('vite --host example.com --port 3001', 4567)).toEqual([])
    expect(configuredServerUrls('echo "http://localhost:3001"', 4567)).toEqual([])
  })
})

describe('startup log URL discovery', () => {
  it('reads ANSI colored output, preserving project base paths and removing duplicates', () => {
    const logs = '\u001b[32m➜ Local: \u001b[1mhttp://localhost:3001/my-app/\u001b[22m\u001b[0m\nReady at http://localhost:3001/my-app/\nDocs: https://vite.dev/guide/'
    expect(discoverServerUrls(logs)).toEqual(['http://localhost:3001/my-app/'])
  })

  it('reads accumulated split log chunks and strips OSC terminal hyperlinks', () => {
    const chunks = ['Listening at http://local', 'host:3010/demo?theme=light\n', '\u001b]8;;http://localhost:3010/demo?theme=light\u0007http://localhost:3010/demo?theme=light\u001b]8;;\u0007']
    expect(discoverServerUrls(chunks.join(''))).toEqual(['http://localhost:3010/demo?theme=light'])
  })

  it('normalizes wildcard binds, preserves IPv6 loopback and supports HTTPS', () => {
    expect(discoverServerUrls('http://0.0.0.0:1234/\nhttp://[::]:2345/demo/\nhttps://[::1]:3456/app/\n(http://127.0.0.1:4567/).')).toEqual(['http://127.0.0.1:1234/', 'http://127.0.0.1:2345/demo/', 'https://[::1]:3456/app/', 'http://127.0.0.1:4567/'])
  })

  it('ignores external links, LAN addresses, credentials, malformed URLs, and non-HTTP protocols', () => {
    expect(discoverServerUrls('Docs https://docs.example.com/ https://localhost.example.com:3000/ http://192.168.1.10:3000/ http://user:password@localhost:3000/ ftp://localhost:3000/ ws://localhost:3000/ http://localhost:99999/')).toEqual([])
  })
})
