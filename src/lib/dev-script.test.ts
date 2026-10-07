import { describe, expect, it } from 'vitest'
import { selectDevScript } from './dev-script'

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
