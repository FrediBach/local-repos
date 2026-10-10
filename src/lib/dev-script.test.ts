import { describe, expect, it } from 'vitest'
import { selectDevScript, simpleCommand } from './dev-script'

describe('startup script selection', () => {
  it('prefers dev, then start, then serve, skipping empty scripts', () => {
    expect(selectDevScript({ scripts: { serve: 'vue-cli-service serve', start: 'react-scripts start', dev: 'vite' } })).toEqual({ name: 'dev', command: 'vite' })
    expect(selectDevScript({ scripts: { dev: '  ', start: 'react-scripts start', serve: 'serve dist' } })).toEqual({ name: 'start', command: 'react-scripts start' })
    expect(selectDevScript({ scripts: { serve: 'vue-cli-service serve' } })).toEqual({ name: 'serve', command: 'vue-cli-service serve' })
  })

  it('does not treat build or preview scripts as development startup scripts', () => {
    expect(selectDevScript({ scripts: { build: 'vite build', preview: 'vite preview' } })).toBeUndefined()
    expect(selectDevScript({ scripts: {} })).toBeUndefined()
  })
})

describe('simple script tokenization', () => {
  it('preserves quoted assignments, escaped spaces, and empty arguments without evaluation', () => {
    expect(simpleCommand('cross-env NODE_OPTIONS="--max-old-space-size=4096 --enable-source-maps" ./node_modules/.bin/vite "web app"')).toEqual({
      tokens: ['./node_modules/.bin/vite', 'web app'], assignments: { NODE_OPTIONS: '--max-old-space-size=4096 --enable-source-maps' },
    })
    expect(simpleCommand('env PORT=3000 npx vite --base="/my app/"')).toEqual({ tokens: ['vite', '--base=/my app/'], assignments: { PORT: '3000' } })
    expect(simpleCommand(String.raw`vite web\ app`)).toEqual({ tokens: ['vite', 'web app'], assignments: {} })
    expect(simpleCommand('vite --mode "" build')).toEqual({ tokens: ['vite', '--mode', '', 'build'], assignments: {} })
    expect(simpleCommand('next dev --port $PORT')?.tokens).toEqual(['next', 'dev', '--port', '$PORT'])
  })

  it.each(['vite "web', "vite 'web", 'vite web\\', 'vite && node api.js', 'vite > output.log', 'vite # comment', '$(echo vite)', 'vite -- --custom', 'env PORT=3000'])('rejects incomplete or compound syntax: %s', command => {
    expect(simpleCommand(command)).toBeUndefined()
  })
})
