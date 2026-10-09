import type { RepoProject } from '../types'

const reactPackages = new Set(['react', 'react-dom', 'react-native', 'next', 'expo'])

/** Recognize React apps and libraries, including peer-only workspace packages. */
export function isReactProject(project: Pick<RepoProject, 'dependencies' | 'stack'>): boolean {
  if (project.dependencies?.some(dependency => reactPackages.has(dependency.name))) return true
  return project.stack.some(technology => ['React', 'React Native', 'Next.js'].includes(technology))
}

/** Match React Doctor's score colors; unavailable scores are never healthy. */
export function reactDoctorScoreLevel(score: number | null): 'good' | 'warning' | 'poor' | 'unknown' {
  if (score === null || !Number.isFinite(score)) return 'unknown'
  return score >= 75 ? 'good' : score >= 50 ? 'warning' : 'poor'
}
