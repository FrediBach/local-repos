import type { RepoProject } from '@/types'

const now = Date.now()
const sample = (id: string, name: string, description: string, stack: string[], hours: number, branch = 'main'): RepoProject => ({
  id, name, description, stack, dirName: name, relativePath: name,
  version: '0.1.0', author: 'You', license: 'MIT', scripts: { dev: 'vite', build: 'vite build' }, packageManager: 'npm',
  git: { branch, commit: '8f2a6c1', message: 'A little progress, every day.', committedAt: new Date(now - hours * 3_600_000).toISOString() },
  updatedAt: new Date(now - hours * 3_600_000).toISOString(), scannedAt: new Date(now).toISOString(),
  readme: `# ${name}\n\n${description}\n\n## Getting started\n\nInstall dependencies with npm install, then run npm run dev.\n\nThis is an example project. Connect a directory to explore your own repositories.`,
})
export const demoProjects: RepoProject[] = [
  sample('demo-form', 'form-and-function', 'A quieter corner of the internet. A personal portfolio for thoughtful work.', ['Next.js', 'React', 'Tailwind'], 2),
  sample('demo-margin', 'margin', 'A simple space to collect thoughts, make connections, and keep writing.', ['React', 'TypeScript', 'Vite'], 5, 'feat/editor'),
  sample('demo-sunday', 'sunday-supply', 'Everyday objects, carefully chosen. An experiment in considered commerce.', ['Next.js', 'TypeScript', 'Tailwind'], 24),
  sample('demo-orbit', 'orbit-dashboard', 'A clear view of the numbers that matter. Analytics without the noise.', ['React', 'TypeScript', 'Vite'], 48, 'develop'),
  sample('demo-field', 'field-notes', 'Small observations from outside. A journal of places, walks, and detours.', ['Astro', 'TypeScript'], 96),
  sample('demo-toolbox', 'little-tools', 'A growing collection of small utilities that make the everyday a little easier.', ['Vue', 'TypeScript', 'Vite'], 168),
]
