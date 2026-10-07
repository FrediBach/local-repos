import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { scanDirectory } from './scanner'
import { updateProject } from './package-update'

const exec = promisify(execFile)

it('updates a real npm workspace within version bounds using its shared lockfile and without lifecycle scripts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-update-cli-test-'))
  const registry = createServer()
  try {
    const name = 'local-repos-update-fixture'
    const versions = ['1.2.0', '1.2.4', '1.3.2', '2.0.0']
    const tarballs = new Map<string, Buffer>()
    for (const version of versions) {
      const pack = path.join(directory, 'tarballs', version)
      await mkdir(path.join(pack, 'package'), { recursive: true })
      await writeFile(path.join(pack, 'package/package.json'), JSON.stringify({ name, version, scripts: { postinstall: 'node -e "process.exit(42)"' } }))
      await exec('tar', ['-czf', path.join(pack, 'package.tgz'), '-C', pack, 'package'])
      tarballs.set(version, await readFile(path.join(pack, 'package.tgz')))
    }
    let url = ''
    registry.on('request', (request, response) => {
      const tar = /^\/tar\/(\d+\.\d+\.\d+)\.tgz$/.exec(request.url ?? '')
      if (tar && tarballs.has(tar[1])) { response.end(tarballs.get(tar[1])); return }
      if (request.url?.split('?')[0] !== `/${name}`) { response.writeHead(404).end('{}'); return }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ name, 'dist-tags': { latest: '2.0.0' }, versions: Object.fromEntries(versions.map(version => [version, { name, version, dist: { tarball: `${url}/tar/${version}.tgz` }, scripts: { postinstall: 'node -e "process.exit(42)"' } }])) }))
    })
    await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve))
    const address = registry.address()
    if (!address || typeof address === 'string') throw new Error('No registry address')
    url = `http://127.0.0.1:${address.port}`
    const repo = path.join(directory, 'repo')
    await mkdir(path.join(repo, 'apps/web'), { recursive: true })
    await mkdir(path.join(repo, 'apps/admin'), { recursive: true })
    const rootManifest = { name: 'studio', private: true, workspaces: ['apps/*'], scripts: { preinstall: 'node -e "process.exit(42)"' } }
    const webManifest = { name: 'web', dependencies: { [name]: '1.2.0' }, scripts: { postinstall: 'node -e "process.exit(42)"' } }
    const adminManifest = { name: 'admin', dependencies: { [name]: '1.2.0' } }
    await writeFile(path.join(repo, 'package.json'), JSON.stringify(rootManifest))
    await writeFile(path.join(repo, 'apps/web/package.json'), JSON.stringify(webManifest))
    await writeFile(path.join(repo, 'apps/admin/package.json'), JSON.stringify(adminManifest))
    await writeFile(path.join(repo, '.npmrc'), `registry=${url}\nfetch-retries=0\n`)
    await writeFile(path.join(directory, 'user.npmrc'), '')
    await writeFile(path.join(directory, 'global.npmrc'), '')
    for (const key of Object.keys(process.env)) if (/^npm_config_/i.test(key)) vi.stubEnv(key, undefined)
    vi.stubEnv('npm_config_registry', url)
    vi.stubEnv('npm_config_userconfig', path.join(directory, 'user.npmrc'))
    vi.stubEnv('npm_config_globalconfig', path.join(directory, 'global.npmrc'))
    vi.stubEnv('npm_config_cache', path.join(directory, 'cache'))
    await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: repo, timeout: 20_000 })
    const { registered } = await scanDirectory(repo)
    const web = registered.find(entry => entry.project.name === 'web')!
    expect(web.workspaceDirectory).toBeTruthy()
    const patch = await updateProject(web, 'patch')
    expect(patch.packages).toEqual([{ name, from: '1.2.0', to: '1.2.4', kind: 'dependencies' }])
    expect(JSON.parse(await readFile(path.join(repo, 'apps/web/package.json'), 'utf8')).dependencies[name]).toBe('1.2.4')
    expect(JSON.parse(await readFile(path.join(repo, 'apps/admin/package.json'), 'utf8'))).toEqual(adminManifest)
    expect(JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))).toEqual(rootManifest)
    const minor = await updateProject(web, 'minor')
    expect(minor.packages).toEqual([{ name, from: '1.2.4', to: '1.3.2', kind: 'dependencies' }])
    expect(JSON.parse(await readFile(path.join(repo, 'apps/web/package.json'), 'utf8')).dependencies[name]).toBe('1.3.2')
    await expect(stat(path.join(repo, 'apps/web/package-lock.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const lock = JSON.parse(await readFile(path.join(repo, 'package-lock.json'), 'utf8'))
    expect(lock.packages['apps/web'].dependencies[name]).toBe('1.3.2')
    expect(lock.packages['apps/admin'].dependencies[name]).toBe('1.2.0')
  } finally {
    vi.unstubAllEnvs()
    await new Promise<void>(resolve => registry.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
