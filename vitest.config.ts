import { defineConfig } from 'vitest/config'
export default defineConfig({ resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } }, test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'config/**/*.test.ts'], maxWorkers: 2 } })
