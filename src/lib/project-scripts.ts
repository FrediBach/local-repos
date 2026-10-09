export const scriptCategories = [
  ['development', 'Development'], ['storybook', 'Storybook'], ['test', 'Tests'],
  ['quality', 'Checks & formatting'], ['build', 'Build'], ['preview', 'Preview'],
  ['scaffold', 'Scaffolding & code generation'], ['docs', 'Documentation'], ['other', 'Other scripts'],
] as const

export type ScriptCategory = typeof scriptCategories[number][0]
export interface ProjectScript { name: string; command: string; category: ScriptCategory }
type Scripts = { scripts: Record<string, string> }

const lifecycle = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'prepare', 'postpublish', 'publish', 'preversion', 'version', 'postversion', 'prestart', 'poststart', 'prestop', 'stop', 'poststop', 'prerestart', 'restart', 'postrestart', 'pretest', 'posttest'])

const testCommands = new Set(['vitest', 'jest', 'playwright', 'cypress', 'mocha', 'ava', 'uvu', 'testcafe', 'karma', 'nyc', 'c8', 'test-storybook'])
const frameworkCommands = new Set(['vite', 'next', 'astro', 'nuxt', 'nuxi', 'ng', 'react-scripts', 'vue-cli-service', 'webpack', 'parcel', 'remix', 'react-router'])
const taskRunners = new Set(['turbo', 'nx', 'npm', 'pnpm', 'yarn', 'bun', 'run-s', 'run-p', 'npm-run-all'])

/** Split names at word boundaries, including testUnit and build:storybook. */
function words(name: string): string[] {
  return name.replace(/([a-z\d])([A-Z])/g, '$1:$2').toLowerCase().split(/[^a-z\d]+/)
}

function namedCategory(name: string): ScriptCategory | undefined {
  const parts = new Set(words(name))
  const has = (...names: string[]) => names.some(value => parts.has(value))
  // Task modifiers take precedence over the tool (test:storybook, build:docs).
  if (has('test', 'tests', 'spec', 'unit', 'e2e', 'integration', 'coverage', 'testcafe', 'vitest', 'jest', 'playwright', 'cypress')) return 'test'
  if (has('build', 'bundle', 'compile')) return 'build'
  if (has('preview')) return 'preview'
  if (has('scaffold', 'generate', 'generator', 'gen', 'codegen', 'create', 'new', 'plop', 'hygen')) return 'scaffold'
  if (has('lint', 'eslint', 'stylelint', 'check', 'checks', 'typecheck', 'type', 'types', 'format', 'prettier', 'verify', 'validate')) return 'quality'
  if (has('storybook', 'stories')) return 'storybook'
  if (has('docs', 'documentation', 'vitepress', 'docusaurus')) return 'docs'
  if (has('dev', 'develop', 'development', 'start', 'serve')) return 'development'
  return undefined
}

/** Read command heads, never execute or expand shell text. Quoted arguments
 * stay together so `echo "vitest"` does not turn into a test command. */
function commandHeads(command: string): string[][] {
  const tokens = command.match(/(?:\\.|"(?:\\.|[^"\\])*"|'[^']*'|[^\s"';&|\\])+|&&|\|\||[;&|]/g) ?? []
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (/^[;&|]+$/.test(token)) segments.push([])
    else segments[segments.length - 1].push(token.replace(/^(['"])(.*)\1$/, '$2'))
  }
  return segments.map(tokens => {
    while (tokens.length && (/^[A-Za-z_][\w]*=/.test(tokens[0]) || ['env', 'cross-env', 'cross-env-shell'].includes(tokens[0]))) tokens.shift()
    if (tokens[0] === 'npx') {
      tokens.shift()
      if (['-y', '--yes', '--no-install'].includes(tokens[0])) tokens.shift()
    } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(tokens[0]) && ['exec', 'dlx', 'x'].includes(tokens[1])) tokens.splice(0, 2)
    if (tokens[0]) tokens[0] = tokens[0].split('/').pop()!.replace(/\.cmd$/, '')
    return tokens
  })
}

function commandCategory(command: string): ScriptCategory | undefined {
  const categories = commandHeads(command).map(([binary, task, ...args]): ScriptCategory | undefined => {
    const rest = [task, ...args]
    if (testCommands.has(binary) || (binary === 'node' && rest.includes('--test'))) return 'test'
    if (['eslint', 'stylelint', 'prettier', 'biome', 'svelte-check', 'oxlint'].includes(binary)) return 'quality'
    if (['tsc', 'vue-tsc'].includes(binary)) return rest.some(arg => /^--noEmit(?:=true)?$/.test(arg ?? '')) ? 'quality' : 'build'
    if (['plop', 'hygen', 'graphql-codegen', 'graphql-code-generator', 'openapi-generator-cli', 'orval'].includes(binary)) return 'scaffold'
    if (binary === 'ng' && ['generate', 'g'].includes(task)) return 'scaffold'
    if (binary === 'build-storybook') return 'build'
    if (binary === 'start-storybook') return 'storybook'
    if (binary === 'storybook') return task === 'build' ? 'build' : task === 'dev' ? 'storybook' : undefined
    if (['vitepress', 'vuepress', 'docusaurus', 'typedoc'].includes(binary)) return task === 'build' ? 'build' : 'docs'
    if (frameworkCommands.has(binary)) {
      if (['build', 'generate', 'export'].includes(task)) return 'build'
      if (task === 'preview') return 'preview'
      if (task === 'test' || task === 'e2e') return 'test'
      if (['lint', 'check', 'typecheck'].includes(task)) return 'quality'
      if (['dev', 'start', 'serve'].includes(task) || (['vite', 'nuxt', 'nuxi', 'parcel'].includes(binary) && (!task || task.startsWith('-') || (binary === 'parcel' && /\.html$/.test(task))))) return 'development'
    }
    if (binary === 'webpack-dev-server') return 'development'
    if (['rollup', 'tsup', 'esbuild', 'unbuild'].includes(binary)) return 'build'
    if (binary === 'serve' || binary === 'http-server') return 'preview'
    if (taskRunners.has(binary)) {
      return namedCategory(task === 'run' ? args[0] ?? '' : task ?? '')
    }
    return undefined
  }).filter((category): category is ScriptCategory => !!category)
  // Compound build scripts commonly start with a type check.
  return categories.find(category => category !== 'quality') ?? categories[0]
}

export function discoverProjectScripts({ scripts }: Scripts): ProjectScript[] {
  return Object.entries(scripts).flatMap(([name, command]): ProjectScript[] => {
    if (!name || name.startsWith('-') || /[\u0000-\u001f\u007f]/.test(name) || typeof command !== 'string' || !command.trim() || lifecycle.has(name)) return []
    if (/^(pre|post)/.test(name) && Object.hasOwn(scripts, name.replace(/^(pre|post)/, ''))) return []
    if (/^\s*echo\s+['"]?(?:Error:\s*)?no test specified['"]?\s*(?:&&|;)\s*exit\s+1\s*$/i.test(command)) return []
    return [{ name, command, category: namedCategory(name) ?? commandCategory(command) ?? 'other' }]
  }).sort((a, b) => scriptCategories.findIndex(([category]) => category === a.category) - scriptCategories.findIndex(([category]) => category === b.category)
    || words(a.name).length - words(b.name).length || a.name.localeCompare(b.name))
}

/** Shell-safe display/copy command, also used by the terminal launcher. */
export function scriptRunCommand(manager: string, name: string): string {
  const quote = (value: string) => /^[\w:./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`
  return `${quote(manager)} run ${quote(name)}`
}
