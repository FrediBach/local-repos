import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { scanDirectory } from './scanner'
import { auditProject } from './package-audit'
import { fixAuditFinding } from './package-audit-fix'
import { auditFixRequest } from '../src/lib/audit-fix'

const exec = promisify(execFile)

it('installs a real compatible npm vulnerability fix and verifies it against a disposable registry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-audit-fix-cli-'))
  const registry = createServer()
  try {
    const name = 'local-repos-audit-fix-fixture'
    const versions = ['1.0.0', '1.1.0', '2.0.0']
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
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/-/npm/v1/security/advisories/bulk') {
        response.end(JSON.stringify({ [name]: [{ id: 123456, name, severity: 'high', title: 'Fixture vulnerability', url: 'https://example.com/fixture-advisory', vulnerable_versions: '<1.1.0' }] }))
        return
      }
      if (request.url?.split('?')[0] !== `/${name}`) { response.writeHead(404).end('{}'); return }
      response.end(JSON.stringify({ name, 'dist-tags': { latest: '2.0.0' }, versions: Object.fromEntries(versions.map(version => [version, { name, version, dist: { tarball: `${url}/tar/${version}.tgz` }, scripts: { postinstall: 'node -e "process.exit(42)"' } }])) }))
    })
    await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve))
    const address = registry.address()
    if (!address || typeof address === 'string') throw new Error('No registry address')
    url = `http://127.0.0.1:${address.port}`
    const repo = path.join(directory, 'repo')
    await mkdir(repo)
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fix-fixture', dependencies: { [name]: '1.0.0' }, scripts: { preinstall: 'node -e "process.exit(42)"' } }))
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
    const entry = registered.find(item => item.project.name === 'fix-fixture')!
    const before = await auditProject(entry)
    expect(before.findings).toHaveLength(1)
    expect(before.findings[0].fixAvailable).toBe(true)
    const result = await fixAuditFinding(entry, auditFixRequest(before.findings[0]))
    expect(result.packages).toEqual([{ name, from: '1.0.0', to: '1.1.0', kind: 'dependencies' }])
    const manifest = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
    const lock = JSON.parse(await readFile(path.join(repo, 'package-lock.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ [name]: '1.1.0' })
    expect(lock.packages[`node_modules/${name}`].version).toBe('1.1.0')
    expect((await auditProject(entry)).findings).toEqual([])
  } finally {
    vi.unstubAllEnvs()
    await new Promise<void>(resolve => registry.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
