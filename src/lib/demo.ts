import type { ProjectDependency, RepoProject } from '@/types'

const now = Date.now()
function sampleDependencies(stack: string[], hours: number): ProjectDependency[] {
  const dependencies: ProjectDependency[] = []
  const add = (name: string, version: string, kind: ProjectDependency['kind'] = 'dependencies') => dependencies.push({ name, version, kind })
  if (stack.includes('React') || stack.includes('Next.js')) {
    add('react', hours < 24 ? '^19.0.0' : '^18.3.1')
    add('react-dom', hours < 24 ? '^19.0.0' : '^18.3.1')
  }
  if (stack.includes('Next.js')) add('next', hours < 24 ? '^15.0.0' : '^14.2.0')
  if (stack.includes('Vue')) add('vue', '^3.5.0')
  if (stack.includes('Astro')) add('astro', '^5.0.0')
  if (stack.includes('TypeScript')) add('typescript', '~5.7.0', 'devDependencies')
  if (stack.includes('Vite')) add('vite', '^6.0.0', 'devDependencies')
  if (stack.includes('Tailwind')) add('tailwindcss', '^4.0.0', 'devDependencies')
  return dependencies
}
const sample = (id: string, name: string, description: string, stack: string[], hours: number, branch = 'main'): RepoProject => ({
  id, name, description, stack, dirName: name, relativePath: name,
  version: '0.1.0', author: 'You', license: 'MIT', scripts: { dev: 'vite', build: 'vite build' }, packageManager: 'npm',
  dependencies: sampleDependencies(stack, hours),
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
