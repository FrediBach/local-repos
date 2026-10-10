import { z } from 'zod'
import type { RepoProject } from '../src/types'
import { packageMatches } from '../src/lib/packages'
import { discoverProjectScripts } from '../src/lib/project-scripts'
import { projectTodos } from '../src/lib/project-todos'
import { configureOutdatedReport, OUTDATED_SCORE_EXPLANATION } from '../src/lib/outdated'
import { isReactProject } from '../src/lib/react-doctor'
import { isLighthouseProject } from '../src/lib/lighthouse'
import { defaultSettings } from '../src/lib/settings'
import type { HelperApplication } from './application'
import { isWithin, type RegisteredProject } from './scanner'
import { allowedRoot, type Principal, type AllowedRoot } from './mcp/policy'
import { McpFailure } from './mcp/errors'
import { clean, cleanText, Cursors, digest, utf8Chunk } from './mcp/output'
import * as s from './mcp/schemas'

export interface PageQuery { limit?: number; cursor?: string }
export const filtersSchema = z.strictObject({ stack: z.array(s.text).max(30).optional(), packageManager: z.array(s.manager).max(4).optional(), hasPackageJson: z.boolean().optional(), gitDirty: z.boolean().optional(), devStatus: z.array(z.enum(['stopped', 'starting', 'running', 'error'])).max(4).optional(), reportKind: s.reportKind.optional(), reportAvailability: z.array(s.availability).max(4).optional(), dependency: z.strictObject({ name: z.string().min(1).max(256), version: z.string().min(1).max(256).optional() }).optional() })
export interface ListQuery extends PageQuery { rootId?: string; query?: string; filters?: z.infer<typeof filtersSchema>; sort?: string }
interface ReportState { value?: unknown; invalidation?: { at: string; reason: string }; revision: number; lastAttempt?: z.infer<typeof s.reportSummary>['lastAttempt'] }
export class ProjectIndex {
  readonly cursors = new Cursors()
  invalidationCount = 0
  private readonly snapshots = new Map<string, string>()
  private readonly reports = new Map<string, ReportState>()
  constructor(readonly application: HelperApplication) {}
  roots(principal: Principal, rootId?: string) { return rootId ? [allowedRoot(principal, rootId)] : principal.roots }
  entries(principal: Principal, rootId?: string) {
    const ids = new Set<string>()
    for (const root of this.roots(principal, rootId)) {
      const snapshot = this.application.roots.get(root.id)
      if (rootId && !snapshot) throw new McpFailure('ROOT_NOT_SCANNED', 'Scan this root first.')
      for (const [id, membership] of snapshot?.members ?? []) if (membership.observed) ids.add(id)
    }
    return [...ids].map(id => this.application.registry.lookup(id))
  }
  entry(principal: Principal, projectId: string) {
    if (!this.entries(principal).some(entry => entry.project.id === projectId)) throw new McpFailure('PROJECT_NOT_FOUND', 'Project not found.')
    return this.application.registry.lookup(projectId)
  }
  processEntry(principal: Principal, projectId: string) {
    // Use recorded ownership, even after a directory moves or disappears from a scan.
    // This exception never grants filesystem access or permission to start new code.
    const entry = (() => { try { return this.application.registry.lookup(projectId) } catch { return undefined } })()
    if (!entry || !principal.roots.some(root => isWithin(root.directory, entry.directory))) throw new McpFailure('PROJECT_NOT_FOUND', 'Project not found.')
    return entry
  }
  async checkedEntry(principal: Principal, projectId: string, workspace = false): Promise<RegisteredProject> {
    this.entry(principal, projectId)
    const entry = await this.application.registry.get(projectId)
    const allowed = principal.roots.filter(root => isWithin(root.directory, entry.directory)).sort((a, b) => a.directory.length - b.directory.length)
    const selected = allowed.find(root => !workspace || isWithin(root.directory, entry.workspaceDirectory ?? entry.directory))
    if (!selected) throw new McpFailure('ROOT_NOT_ALLOWED', 'This operation needs permission for the effective workspace.')
    // Services must enforce the caller's root, not a broader registry registration.
    return { ...entry, root: selected.directory }
  }
  rootSummary(principal: Principal, root: AllowedRoot) {
    const snapshot = this.application.roots.get(root.id)
    const members = [...snapshot?.members.values() ?? []]
    return { rootId: root.id, name: root.name, ...(principal.disclosePaths ? { path: root.directory } : {}), scanned: !!snapshot, scannedAt: snapshot?.scannedAt, projectCount: members.filter(member => member.observed).length, notObservedCount: members.filter(member => !member.observed).length, warnings: clean(snapshot?.warnings ?? [], principal), completeness: !snapshot ? 'unknown' as const : snapshot.warnings.length ? 'partial' as const : 'complete' as const }
  }
  coverage(projects: RepoProject[], kinds: s.ReportKind[] = s.reportKind.options) {
    const values = projects.flatMap(project => kinds.map(kind => this.reportSummary(project, kind)))
    return { known: values.filter(value => value.availability === 'available').length, missing: values.filter(value => value.availability === 'missing').length, invalidated: values.filter(value => value.availability === 'invalidated').length, partial: values.filter(value => value.completeness === 'partial').length, unsupported: values.filter(value => value.availability === 'unsupported').length, failed: values.filter(value => value.lastAttempt?.status === 'failed').length, completeness: 'unknown' as const }
  }
  page<T>(principal: Principal, key: unknown, values: T[], query: PageQuery = {}, coverage = { known: values.length, missing: 0, invalidated: 0, partial: 0, completeness: 'complete' as 'complete' | 'partial' | 'unknown' }) {
    const sanitized = clean(values, principal)
    const binding = [principal.id, this.application.helperInstanceId, this.application.revision, key, digest(sanitized)]
    const start = this.cursors.offset(query.cursor, binding)
    if (start > values.length) throw new McpFailure('CURSOR_EXPIRED', 'Read the first page again.')
    const items: T[] = []
    let size = 0
    for (const row of sanitized.slice(start, start + (query.limit ?? 25))) {
      const bytes = Buffer.byteLength(JSON.stringify(row))
      if (size + bytes > 32 * 1024) {
        if (!items.length) throw new McpFailure('RESOURCE_LIMIT', 'A result row exceeds the output limit.')
        break
      }
      items.push(row); size += bytes
    }
    const next = start + items.length
    return { items, nextCursor: next < values.length ? this.cursors.encode(binding, next) : null, total: values.length, coverage }
  }
  reportState(project: RepoProject, kind: s.ReportKind) {
    const key = `${project.id}:${kind}`
    let state = this.reports.get(key)
    if (!state) { state = { value: project[kind], revision: this.application.revision }; this.reports.set(key, state) }
    if (state.value !== project[kind]) {
      if (state.value && !project[kind]) state.invalidation = { at: new Date().toISOString(), reason: 'The helper invalidated this report.' }
      if (project[kind]) state.invalidation = undefined
      state.value = project[kind]
      state.revision = ++this.application.revision
    }
    return state
  }
  attempt(project: RepoProject, kind: s.ReportKind, status: 'running' | 'succeeded' | 'failed', operationId: string) {
    this.reportState(project, kind).lastAttempt = { operationId, status, at: new Date().toISOString(), ...(status === 'failed' ? { errorCode: 'OPERATION_FAILED' } : {}) }
    this.application.revision++
  }
  invalidate(project: RepoProject, reason: string, revision = ++this.application.revision) {
    this.invalidationCount += s.reportKind.options.length
    for (const kind of s.reportKind.options) {
      const state = this.reportState(project, kind)
      state.invalidation = { at: new Date().toISOString(), reason }
      project[kind] = undefined
      state.value = undefined
      state.revision = revision
    }
  }
  reportSummary(project: RepoProject, kind: s.ReportKind): z.infer<typeof s.reportSummary> {
    const state = this.reportState(project, kind)
    const report = project[kind]
    const invalidated = !!state.invalidation
    const unsupported = kind === 'storage' ? false : !project.hasPackageJson || (kind === 'reactDoctor' && !isReactProject(project)) || (kind === 'lighthouse' && !isLighthouseProject(project))
    const partial = report && ('partial' in report ? report.partial : 'warning' in report ? !!report.warning : 'warnings' in report ? !!report.warnings?.length : false)
    return { kind, availability: invalidated ? 'invalidated' : report ? 'available' : unsupported ? 'unsupported' : 'missing', measuredAt: report && ('measuredAt' in report ? report.measuredAt : report.scannedAt), freshness: invalidated ? 'changed' : report ? 'snapshot' : 'unknown', completeness: report && !invalidated ? partial ? 'partial' : kind === 'storage' ? 'complete' : 'unknown' : 'unknown', reportRevision: state.revision, invalidation: state.invalidation, lastAttempt: state.lastAttempt }
  }
  summary(principal: Principal, entry: RegisteredProject, rootId?: string) {
    const p = entry.project
    const snapshot = digest([p.dev, p.dependencies, p.scripts, p.git])
    const prior = this.snapshots.get(p.id)
    if (prior && prior !== snapshot) this.application.revision++
    this.snapshots.set(p.id, snapshot)
    const memberships = principal.roots.flatMap(root => {
      const member = this.application.roots.get(root.id)?.members.get(p.id)
      return member?.observed ? [{ rootId: root.id, relativePath: member.relativePath }] : []
    })
    const visible = new Set(this.entries(principal).map(entry => entry.project.id))
    const workspace = this.entries(principal).find(other => other.directory === (entry.workspaceDirectory ?? entry.directory))
    const truncatedFields: string[] = []
    const bounded = (field: string, value: string, bytes: number) => {
      if (Buffer.byteLength(value) > bytes) truncatedFields.push(field)
      return utf8Chunk(value, 0, bytes).text
    }
    const name = bounded('name', p.name, 512)
    const description = bounded('description', p.description, 2048)
    const stack = p.stack.slice(0, 64).map(value => bounded('stack', value, 128))
    if (p.stack.length > stack.length) truncatedFields.push('stack')
    return { id: p.id, name, description, stack, truncatedFields: [...new Set(truncatedFields)], packageManager: p.packageManager, hasPackageJson: !!p.hasPackageJson, rootMemberships: memberships, selectedMembership: rootId ? memberships.find(value => value.rootId === rootId) : undefined, visualGroupId: p.monorepo && visible.has(p.monorepo.id) ? p.monorepo.id : undefined, packageWorkspaceId: workspace?.project.id, git: p.git && (!entry.gitDirectory || principal.roots.some(root => isWithin(root.directory, entry.gitDirectory!))) ? { branch: p.git.branch, dirty: p.git.dirty } : undefined, devStatus: p.dev?.status ?? 'stopped', reports: s.reportKind.options.map(kind => this.reportSummary(p, kind)), scannedAt: p.scannedAt }
  }
  list(principal: Principal, query: ListQuery) {
    const f = query.filters
    let entries = this.entries(principal, query.rootId).filter(({ project: p }) => {
      if (f?.stack && !f.stack.some(stack => p.stack.includes(stack))) return false
      if (f?.packageManager && !f.packageManager.includes(p.packageManager)) return false
      if (f?.hasPackageJson !== undefined && !!p.hasPackageJson !== f.hasPackageJson) return false
      if (f?.gitDirty !== undefined && p.git?.dirty !== f.gitDirty) return false
      if (f?.devStatus && !f.devStatus.includes(p.dev?.status ?? 'stopped')) return false
      if (f?.dependency && !packageMatches(p, `${f.dependency.name}${f.dependency.version ? `@${f.dependency.version}` : ''}`).length) return false
      if (f?.reportAvailability && !(f.reportKind ? [f.reportKind] : s.reportKind.options).some(kind => f.reportAvailability!.includes(this.reportSummary(p, kind).availability))) return false
      if (f?.reportKind && !f.reportAvailability && this.reportSummary(p, f.reportKind).availability !== 'available') return false
      const q = query.query?.toLowerCase().trim()
      return !q || [p.name, p.dirName, p.description, ...p.stack, p.git?.branch, p.git?.origin, p.author, p.license, p.homepage, p.packageManager, ...p.aiInstructionFiles ?? [], ...this.summary(principal, { ...this.application.registry.lookup(p.id), project: p }, query.rootId).rootMemberships.map(member => member.relativePath), ...(p.dependencies ?? []).map(d => `${d.name}@${d.version}`)].some(value => value?.toLowerCase().includes(q))
    })
    const sort = query.sort ?? 'name'
    const field = sort.replace(/^-/, '')
    const value = (entry: RegisteredProject) => field === 'scannedAt' ? entry.project.scannedAt : field === 'path' ? this.summary(principal, entry, query.rootId).rootMemberships.filter(m => !query.rootId || m.rootId === query.rootId).map(m => `${m.rootId}/${m.relativePath}`).sort()[0] ?? '' : entry.project.name
    entries = entries.sort((a, b) => (sort.startsWith('-') ? -1 : 1) * value(a).localeCompare(value(b)) || a.project.id.localeCompare(b.project.id))
    const { cursor: _cursor, limit: _limit, ...key } = query
    const summaries = entries.map(entry => {
      const summary = this.summary(principal, entry, query.rootId)
      const q = query.query?.toLowerCase().trim()
      const dependencyQuery = f?.dependency ? `${f.dependency.name}${f.dependency.version ? `@${f.dependency.version}` : ''}` : q
      const dependencies = dependencyQuery ? packageMatches(entry.project, dependencyQuery) : []
      const fields = q ? Object.entries({ name: entry.project.name, description: entry.project.description, stack: entry.project.stack.join(' '), path: summary.rootMemberships.map(member => member.relativePath).join(' '), branch: entry.project.git?.branch, origin: entry.project.git?.origin, author: entry.project.author, license: entry.project.license, homepage: entry.project.homepage, packageManager: entry.project.packageManager, aiInstructionFiles: entry.project.aiInstructionFiles?.join(' ') }).filter(([, value]) => value?.toLowerCase().includes(q)).map(([key]) => key) : []
      return { ...summary, ...(q || f?.dependency ? { matches: { fields, dependencies: dependencies.slice(0, 5), omittedDependencies: Math.max(0, dependencies.length - 5) } } : {}) }
    })
    return this.page(principal, ['projects', key], summaries, query, this.coverage(entries.map(entry => entry.project)))
  }
  dependencies(principal: Principal, projectId: string, query: PageQuery & { name?: string; kind?: string }) {
    const p = this.entry(principal, projectId).project
    const values = (p.dependencies ?? []).filter(d => (!query.name || d.name.toLowerCase().includes(query.name.toLowerCase())) && (!query.kind || d.kind === query.kind)).sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
    return this.page(principal, ['dependencies', projectId, query.name, query.kind], values, query)
  }
  scripts(principal: Principal, projectId: string, query: PageQuery & { category?: string }) {
    const p = this.entry(principal, projectId).project
    const values = discoverProjectScripts(p).filter(row => !query.category || row.category === query.category).map(row => ({ ...row, command: utf8Chunk(row.command, 0, 4096).text, commandTruncated: Buffer.byteLength(row.command) > 4096, launchEnabled: false as const, manifestRevision: digest(p.scripts) }))
    return this.page(principal, ['scripts', projectId, query.category], values, query)
  }
  detail(principal: Principal, projectId: string, include: string[] = []) {
    const entry = this.entry(principal, projectId), p = entry.project
    const visible = new Set(this.entries(principal).map(entry => entry.project.id))
    return clean({ ...this.summary(principal, entry), version: p.version, author: p.author, license: p.license, homepage: p.homepage, origin: !entry.gitDirectory || principal.roots.some(root => isWithin(root.directory, entry.gitDirectory!)) ? p.git?.origin : undefined, aiInstructionFiles: p.aiInstructionFiles ?? [], relatedProjectIds: this.application.registry.related(projectId).map(entry => entry.project.id).filter(id => visible.has(id)), capabilities: { analysis: principal.capabilities.includes('analysis'), development: principal.capabilities.includes('development'), mutation: false as const, disabledReason: 'Checks require analysis and their network/project-execution capabilities. Development starts require development, network, and project-execution. Mutation is unavailable.' }, resources: [`local-repos://v1/projects/${projectId}`, ...(principal.discloseContent ? [`local-repos://v1/projects/${projectId}/readme`] : []), ...s.reportKind.options.map(kind => `local-repos://v1/projects/${projectId}/reports/${kind}`), ...(p.preview && principal.discloseContent ? [`local-repos://v1/projects/${projectId}/preview`] : [])], ...(include.includes('dependencies') ? { dependencies: this.dependencies(principal, projectId, {}) } : {}), ...(include.includes('scripts') ? { scripts: this.scripts(principal, projectId, {}) } : {}), preview: p.preview ? { capturedAt: p.preview.capturedAt, source: p.preview.source, kind: p.preview.kind, url: p.preview.url } : undefined }, principal)
  }
  readme(principal: Principal, projectId: string, query: { cursor?: string; maxBytes?: number }) {
    if (!principal.discloseContent) throw new McpFailure('CAPABILITY_DISABLED', 'README content disclosure is disabled.')
    const p = this.entry(principal, projectId).project
    const text = cleanText(p.readme ?? '', principal)
    const contentRevision = digest(text)
    const binding = [principal.id, this.application.helperInstanceId, projectId, 'readme', contentRevision]
    const offset = this.cursors.offset(query.cursor, binding)
    let chunk = utf8Chunk(text, offset, query.maxBytes ?? 32 * 1024)
    // Structured output and its escaped text fallback both count on the wire.
    while (Buffer.byteLength(JSON.stringify({ data: chunk.text, content: JSON.stringify(chunk.text) })) > 110 * 1024) chunk = utf8Chunk(text, offset, Math.max(4, Math.floor(Buffer.byteLength(chunk.text) / 2)))
    return { text: chunk.text, contentRevision, nextCursor: chunk.end < chunk.total ? this.cursors.encode(binding, chunk.end) : null, truncated: chunk.end < chunk.total, sourceTimestamp: p.scannedAt, available: p.readme !== undefined }
  }
  report(principal: Principal, projectId: string, kind: s.ReportKind, query: PageQuery) {
    const entry = this.entry(principal, projectId)
    if (kind !== 'storage' && !principal.roots.some(root => isWithin(root.directory, entry.workspaceDirectory ?? entry.directory))) throw new McpFailure('ROOT_NOT_ALLOWED', 'This report requires permission for the package workspace.')
    const p = entry.project
    const summary = this.reportSummary(p, kind)
    const report = summary.availability === 'available' ? p[kind] : undefined
    if (kind === 'storage') {
      if (query.cursor || query.limit !== undefined) throw new McpFailure('INVALID_ARGUMENT', 'Storage is scalar and does not accept pagination.')
      return clean({ ...summary, report }, principal)
    }
    const data = report ? { ...report } as Record<string, unknown> : undefined
    let rows: unknown[] = []
    if (data) {
      rows = (data.findings ?? data.audits ?? []) as unknown[]
      if (kind === 'outdated') rows = [...rows.map(row => ({ ...row as object, rowKind: 'finding' })), ...(data.skipped as object[] ?? []).map(row => ({ ...row, rowKind: 'skipped' }))]
      delete data.findings; delete data.audits; delete data.skipped
    }
    return clean({ ...summary, report: data, rows: this.page(principal, ['report', projectId, kind], rows, query, this.coverage([p], [kind])) }, principal)
  }
  findings(principal: Principal, query: PageQuery & { rootId?: string; projectId?: string; kinds?: string[]; minimumSeverity?: string }) {
    const entries = query.projectId ? [this.entry(principal, query.projectId)].filter(entry => !query.rootId || this.entries(principal, query.rootId).some(other => other.project.id === entry.project.id)) : this.entries(principal, query.rootId)
    const projects = entries.map(({ project, directory, workspaceDirectory }) => {
      const p = { ...project }
      if (!principal.roots.some(root => isWithin(root.directory, workspaceDirectory ?? directory))) { delete p.audit; delete p.outdated; delete p.reactDoctor }
      for (const kind of s.reportKind.options) if (this.reportSummary(project, kind).availability !== 'available') delete p[kind]
      if (p.outdated) p.outdated = configureOutdatedReport(p.outdated, defaultSettings)
      if (query.minimumSeverity === 'critical' && p.audit) p.audit = { ...p.audit, counts: { ...p.audit.counts, high: 0 }, findings: p.audit.findings.filter(finding => finding.severity === 'critical') }
      return p
    })
    const rows = projectTodos(projects).map(todo => ({ ...todo, kind: todo.kind === 'react-doctor' ? 'reactDoctor' : todo.kind, findingKeys: todo.findingKeys.slice(0, 25), findingKeysOmitted: Math.max(0, todo.findingKeys.length - 25) })).filter(todo => !query.kinds || query.kinds.includes(todo.kind))
    const { cursor: _cursor, limit: _limit, ...key } = query
    return { rows: this.page(principal, ['findings', key], rows, query, this.coverage(entries.map(entry => entry.project), ['audit', 'outdated', 'reactDoctor'])), dismissalsAvailable: false as const, scoringPolicy: `Local Repos default settings: ${OUTDATED_SCORE_EXPLANATION}` }
  }
}
