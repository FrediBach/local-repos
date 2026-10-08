import { describe, expect, it } from 'vitest'
import { discoverProjectScripts, scriptRunCommand } from './project-scripts'

describe('frontend script discovery', () => {
  it.each([
    ['test:unit', 'node scripts/unit.mjs', 'test'],
    ['testWatch', 'node scripts/watch.mjs', 'test'],
    ['e2e:ui', 'playwright test --ui', 'test'],
    ['coverage', 'vitest run --coverage', 'test'],
    ['test-storybook', 'test-storybook', 'test'],
    ['storybook', 'storybook dev -p 6006', 'storybook'],
    ['start:storybook', 'storybook dev', 'storybook'],
    ['build:storybook', 'storybook build', 'build'],
    ['storybook:build', 'storybook build', 'build'],
    ['docs:build', 'vitepress build docs', 'build'],
    ['docs:dev', 'vitepress dev docs', 'docs'],
    ['lint:fix', 'eslint . --fix', 'quality'],
    ['type-check', 'vue-tsc --noEmit', 'quality'],
    ['format:check', 'prettier . --check', 'quality'],
    ['generate:types', 'graphql-codegen', 'scaffold'],
    ['new:component', 'node tools/new-component.js', 'scaffold'],
    ['assets:generate', 'node tools/assets.mjs', 'scaffold'],
    ['dev:client', 'node scripts/client.js', 'development'],
    ['preview', 'vite preview', 'preview'],
  ])('classifies %s as %s using name boundaries and task modifiers', (name, command, category) => {
    expect(discoverProjectScripts({ scripts: { [name]: command } })).toEqual([{ name, command, category }])
  })

  it.each([
    ['cross-env NODE_ENV=test ./node_modules/.bin/vitest run', 'test'],
    ['cross-env NODE_OPTIONS="--no-warnings --max-old-space-size=4096" ./node_modules/.bin/vitest run', 'test'],
    ['env NODE_ENV="development" "./node_modules/.bin/storybook" dev', 'storybook'],
    ['npx --no-install playwright test', 'test'],
    ['env NODE_OPTIONS=--no-warnings node --test', 'test'],
    ['pnpm exec cypress open', 'test'],
    ['yarn dlx jest --watch', 'test'],
    ['bun x vitest', 'test'],
    ['react-scripts test', 'test'],
    ['ng e2e', 'test'],
    ['storybook dev -p 6006', 'storybook'],
    ['start-storybook -p 6006', 'storybook'],
    ['storybook build', 'build'],
    ['tsc --noEmit && vite build', 'build'],
    ['tsc --noEmit', 'quality'],
    ['svelte-check --tsconfig tsconfig.json', 'quality'],
    ['biome check .', 'quality'],
    ['plop', 'scaffold'],
    ['hygen component new', 'scaffold'],
    ['ng generate component example', 'scaffold'],
    ['graphql-codegen --config codegen.ts', 'scaffold'],
    ['orval', 'scaffold'],
    ['next dev', 'development'],
    ['vite', 'development'],
    ['astro preview', 'preview'],
    ['serve dist', 'preview'],
    ['vitepress dev docs', 'docs'],
    ['turbo run test', 'test'],
    ['nx run app:test', 'test'],
    ['pnpm run generate:component', 'scaffold'],
  ])('recognizes tools behind a custom script name: %s', (command, category) => {
    expect(discoverProjectScripts({ scripts: { custom: command } })[0].category).toBe(category)
  })

  it('does not match incidental words or quoted command arguments', () => {
    const scripts = { contest: 'echo "vitest && storybook dev"', latest: 'node latest.js', device: 'echo vite', storybookish: 'node tool.js', regenerateIndex: 'node tool.js', release: 'changeset publish' }
    expect(discoverProjectScripts({ scripts }).every(script => script.category === 'other')).toBe(true)
  })

  it('skips empty scripts, lifecycle hooks, placeholders, and option-like names', () => {
    const scripts = { test: 'echo "Error: no test specified" && exit 1', blank: ' ', preinstall: 'node setup.js', prepare: 'husky', prebuild: 'node setup.js', build: 'vite build', 'pretest:unit': 'node setup.js', 'test:unit': 'vitest run', postbuild: 'node cleanup.js', '--help': 'echo option', 'bad\nname': 'echo invalid', preview: 'vite preview' }
    expect(discoverProjectScripts({ scripts }).map(script => script.name)).toEqual(['test:unit', 'build', 'preview'])
  })

  it('keeps all variants, sorts base tasks first, and gives the same order after rescanning', () => {
    const scripts = { 'test:watch': 'vitest', build: 'vite build', test: 'vitest run', storybook: 'storybook dev', 'test:e2e': 'playwright test', dev: 'vite', utility: 'node script.js' }
    const discovered = discoverProjectScripts({ scripts })
    expect(discovered.map(script => script.name)).toEqual(['dev', 'storybook', 'test', 'test:e2e', 'test:watch', 'build', 'utility'])
    expect(discoverProjectScripts({ scripts: Object.fromEntries(Object.entries(scripts).reverse()) })).toEqual(discovered)
  })

  it.each(['npm', 'pnpm', 'yarn', 'bun'])('uses %s and quotes unusual script names for copying and terminal execution', manager => {
    expect(scriptRunCommand(manager, 'test:e2e')).toBe(`${manager} run test:e2e`)
    expect(scriptRunCommand(manager, "test's $(touch nope)")).toBe(`${manager} run 'test'"'"'s $(touch nope)'`)
  })
})
