import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { outdatedProject } from './package-outdated'
import type { RegisteredProject } from './scanner'

async function snapshot(directory: string, relative = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const filename = path.join(relative, entry.name)
    if (entry.isDirectory()) Object.assign(files, await snapshot(directory, filename))
    else files[filename] = await readFile(path.join(directory, filename), 'utf8')
  }
  return files
}

it.skipIf(process.platform === 'win32')('checks real npm reports against a local registry without changing project files or running scripts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-repos-outdated-cli-test-'))
  const names = ['local-repos-fixture-direct', '@local-repos/fixture-dev', 'local-repos-fixture-optional']
  const requests: string[] = []
  const unexpectedRequests: string[] = []
  let latest = '3.0.0'
  let unavailable: string | undefined
  let registryUrl = ''
  const registry = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').split('?')[0].slice(1))
    requests.push(name)
    response.setHeader('Content-Type', 'application/json')
    if (!names.includes(name)) unexpectedRequests.push(name)
    if (!names.includes(name) || name === unavailable) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Fixture package not found' }))
      return
    }
    const versions = latest === '1.0.0' ? ['1.0.0'] : ['1.0.0', '1.0.1', '3.0.0']
    response.end(JSON.stringify({
      name, 'dist-tags': { latest },
      versions: Object.fromEntries(versions.map(version => [version, { name, version, dist: { tarball: `${registryUrl}/${name}/-/${version}.tgz` } }])),
    }))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      registry.once('error', reject)
      registry.listen(0, '127.0.0.1', resolve)
    })
    const address = registry.address()
    if (!address || typeof address === 'string') throw new Error('Fixture registry did not bind a port')
    registryUrl = `http://127.0.0.1:${address.port}`
    const manifest = {
      name: 'local-repos-outdated-cli-fixture', version: '1.0.0', private: true,
      dependencies: { [names[0]]: '^1.0.0' },
      devDependencies: { [names[1]]: '^1.0.0' },
      optionalDependencies: { [names[2]]: '^1.0.0' },
      scripts: { preinstall: 'node -e "require(\'fs\').writeFileSync(\'script-ran\',\'unexpected\')"' },
    }
    const packages: Record<string, unknown> = { '': manifest }
    for (const [index, name] of names.entries()) {
      const installed = path.join(directory, 'node_modules', name)
      await mkdir(installed, { recursive: true })
      await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
      packages[`node_modules/${name}`] = { version: '1.0.0', resolved: `${registryUrl}/${name}/-/1.0.0.tgz`, ...(index === 1 ? { dev: true } : {}), ...(index === 2 ? { optional: true } : {}) }
    }
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest))
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }))
    await writeFile(path.join(directory, '.npmrc'), `registry=${registryUrl}\n@local-repos:registry=${registryUrl}\nfetch-retries=0\n`)
    await writeFile(path.join(directory, 'empty-user.npmrc'), '')
    await writeFile(path.join(directory, 'empty-global.npmrc'), '')
    // Isolate registry routing from user/global/scoped npm configuration. Every
    // package endpoint and tarball points at the fixture; no installs are run.
    for (const key of Object.keys(process.env)) if (/^npm_config_/i.test(key)) vi.stubEnv(key, undefined)
    vi.stubEnv('npm_config_registry', registryUrl)
    vi.stubEnv('npm_config_userconfig', path.join(directory, 'empty-user.npmrc'))
    vi.stubEnv('npm_config_globalconfig', path.join(directory, 'empty-global.npmrc'))
    vi.stubEnv('npm_config_fetch_retries', '0')
    vi.stubEnv('npm_config_fetch_timeout', '3000')
    vi.stubEnv('npm_config_omit', 'dev')
    const entry: RegisteredProject = { directory, root: directory, project: {
      id: 'real-outdated-fixture', name: manifest.name, dirName: 'fixture', relativePath: '.', description: '',
      packageManager: 'npm', stack: [], scripts: manifest.scripts, scannedAt: new Date().toISOString(),
    } }
    const original = await snapshot(directory)
    const result = await outdatedProject(entry)
    expect(result).toMatchObject({ manager: 'npm', score: 60, level: 'moderate' })
    expect(result.findings).toHaveLength(3)
    expect(new Set(result.findings.map(finding => finding.kind))).toEqual(new Set(['dependencies', 'devDependencies', 'optionalDependencies']))
    for (const finding of result.findings) expect(finding).toMatchObject({ current: '1.0.0', wanted: '1.0.1', latest: '3.0.0', change: 'major', majorGap: 2, score: 20 })
    expect(new Set(requests)).toEqual(new Set(names))
    expect(await snapshot(directory)).toEqual(original)

    latest = '1.0.0'
    requests.length = 0
    expect(await outdatedProject(entry)).toMatchObject({ findings: [], score: 0, level: 'current' })
    expect(new Set(requests)).toEqual(new Set(names))
    expect(await snapshot(directory)).toEqual(original)

    latest = '3.0.0'
    unavailable = names[0]
    await expect(outdatedProject(entry)).rejects.toMatchObject({ status: 502 })
    expect(await snapshot(directory)).toEqual(original)

    unavailable = undefined
    await rm(path.join(directory, 'node_modules'), { recursive: true, force: true })
    const withoutModules = await snapshot(directory)
    const locked = await outdatedProject(entry)
    expect(locked).toMatchObject({ score: 60, level: 'moderate' })
    expect(new Set(locked.findings.map(finding => finding.name))).toEqual(new Set(names))
    for (const finding of locked.findings) expect(finding).toMatchObject({ current: '1.0.0', latest: '3.0.0' })
    expect(await snapshot(directory)).toEqual(withoutModules)
    expect(unexpectedRequests).toEqual([])
  } finally {
    vi.unstubAllEnvs()
    await new Promise<void>(resolve => registry.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
