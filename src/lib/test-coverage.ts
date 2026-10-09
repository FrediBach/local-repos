import type { CoverageMetric, CoverageRunner, RepoProject } from '../types'

type CoverageProject = Pick<RepoProject, 'dependencies' | 'scripts' | 'testCoverage' | 'hasPackageJson'>
const scriptNames = ['test:coverage', 'coverage', 'test:unit', 'test']
const nativeRunners = ['vitest', 'react-scripts', 'jest'] as const
const percentFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const reportPackages = new Set(['nyc', 'c8', 'cypress', '@cypress/code-coverage', '@playwright/test', 'playwright', 'karma-coverage', '@web/test-runner', '@web/test-runner-coverage', 'istanbul'])

/** Parse simple runner arguments without shell expansion or executable wrappers. */
function scriptTokens(script: string): string[] | undefined {
  if (/[\n\r;&|<>`$]/.test(script)) return undefined
  const tokens: string[] = []
  let token = '', quote = '', started = false
  for (const character of script.trim()) {
    if (character === '\\') return undefined
    if (quote) { if (character === quote) quote = ''; else token += character; started = true }
    else if (character === '"' || character === "'") { quote = character; started = true }
    else if (/\s/.test(character)) { if (started) { tokens.push(token); token = ''; started = false } }
    else { token += character; started = true }
  }
  if (quote) return undefined
  if (started) tokens.push(token)
  return tokens.length ? tokens : undefined
}

export interface CoverageScriptSelection { runner?: Exclude<CoverageRunner, 'report'>; args: string[]; env?: Record<string, string>; reason?: string }

/** Shared with the helper so the scan button describes the command actually selected. */
export function selectCoverageScript(scripts: Record<string, unknown>): CoverageScriptSelection | undefined {
  for (const key of scriptNames) {
    const script = scripts[key]
    if (typeof script !== 'string' || !script.trim() || /^echo\s+["']?Error: no test specified/.test(script.trim())) continue
    const tokens = scriptTokens(script)
    const environment: [string, string][] = []
    let commandIndex = 0
    const readEnvironment = () => {
      let assignment: RegExpMatchArray | null
      while ((assignment = tokens?.[commandIndex]?.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) ?? null)) {
        environment.push([assignment[1], assignment[2]])
        commandIndex++
      }
    }
    readEnvironment()
    if (tokens?.[commandIndex] === 'env' || tokens?.[commandIndex] === 'cross-env') {
      commandIndex++
      readEnvironment()
    }
    const command = tokens?.[commandIndex]
    const runner = nativeRunners.find(name => command === name || command === `node_modules/.bin/${name}` || command === `./node_modules/.bin/${name}`)
    if (!tokens || !runner) return { args: [], reason: `The ${key} script uses a wrapper, shell commands, or a runner that cannot be launched directly.` }
    const args = tokens.slice(commandIndex + 1)
    if (runner === 'react-scripts' && args.shift() !== 'test') return { args: [], reason: 'The react-scripts command is not a test script.' }
    if (runner === 'vitest' && args[0] === 'run') args.shift()
    if (args.some(arg => ['bench', 'related', 'watch', 'dev', 'list', 'init', '--help', '-h', '--version', '-v'].includes(arg))) return { args: [], reason: 'The test script selects an interactive or partial runner command.' }
    return { runner, args, ...(environment.length ? { env: Object.fromEntries(environment) } : {}) }
  }
  return undefined
}

/** Native runners execute locally; other known setups can import existing coverage. */
export function detectCoverageRunner(project: CoverageProject): CoverageRunner | null {
  const selected = selectCoverageScript(project.scripts)
  if (selected?.runner) return selected.runner
  if (!selected) {
    for (const runner of nativeRunners) {
      if (project.dependencies?.some(dependency => dependency.name === runner && ['dependencies', 'devDependencies'].includes(dependency.kind))) return runner
    }
  }
  if (project.testCoverage || project.dependencies?.some(dependency => reportPackages.has(dependency.name) || (nativeRunners as readonly string[]).includes(dependency.name))
    || Object.values(project.scripts).some(script => /(?:^|[\s;&|])(?:[^\s;&|]*[/\\])?(?:vitest|jest|react-scripts|nyc|c8|cypress|playwright|istanbul)(?=$|[\s;&|])/.test(script))) return 'report'
  return null
}

/** Batch scans skip package projects that have no known coverage setup or saved report. */
export function isCoverageProject(project: CoverageProject): boolean {
  return detectCoverageRunner(project) !== null
}

/** Any package project can try importing a report from its own coverage tooling. */
export function canInspectCoverage(project: CoverageProject): boolean {
  return !!project.hasPackageJson || isCoverageProject(project)
}

export const coverageRunnerLabels: Record<CoverageRunner, string> = {
  vitest: 'Vitest', jest: 'Jest', 'react-scripts': 'Create React App', report: 'Coverage report',
}

export function coveragePercent(metric: CoverageMetric | null | undefined): number | null {
  return metric && metric.total > 0 && metric.pct !== null && Number.isFinite(metric.pct) ? metric.pct : null
}

export function formatCoveragePercent(metric: CoverageMetric | null | undefined): string {
  const pct = coveragePercent(metric)
  return pct === null ? '—' : `${percentFormatter.format(pct)}%`
}

export function coverageLevel(metric: CoverageMetric | null | undefined): 'good' | 'warning' | 'poor' | 'unknown' {
  const pct = coveragePercent(metric)
  return pct === null ? 'unknown' : pct >= 80 ? 'good' : pct >= 50 ? 'warning' : 'poor'
}
