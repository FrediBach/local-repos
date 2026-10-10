import { z } from 'zod'

export const text = z.string().max(32_768)
export const id = z.string().regex(/^[a-f0-9]{20}$/)
export const root = z.string().regex(/^root_[a-f0-9]{20}$/)
export const operationId = z.string().regex(/^op_[a-f0-9-]{36}$/)
export const requestId = z.string().min(1).max(128)
export const cursor = z.string().max(4096).optional()
export const pageInput = { limit: z.number().int().min(1).max(100).default(25), cursor }
export const reportKind = z.enum(['storage', 'audit', 'outdated', 'unused', 'reactDoctor', 'lighthouse'])
export type ReportKind = z.infer<typeof reportKind>
export const availability = z.enum(['available', 'missing', 'invalidated', 'unsupported'])
export const manager = z.enum(['npm', 'pnpm', 'yarn', 'bun'])
export const severity = z.enum(['info', 'low', 'moderate', 'high', 'critical'])
export const dependencyKind = z.enum(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
export const scriptCategory = z.enum(['development', 'storybook', 'test', 'quality', 'build', 'preview', 'scaffold', 'docs', 'other'])
export const warning = z.object({ code: text, message: text, projectId: id.optional() })
export const coverage = z.object({ known: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), invalidated: z.number().int().nonnegative(), partial: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative().default(0), failed: z.number().int().nonnegative().default(0), completeness: z.enum(['complete', 'partial', 'unknown']) })
export const page = <T extends z.ZodType>(row: T) => z.object({ items: z.array(row).max(100), nextCursor: z.string().nullable(), total: z.number().int().nonnegative(), coverage })
export const dependency = z.object({ name: text, version: text, kind: dependencyKind })
export const script = z.object({ name: text, command: text, category: scriptCategory, commandTruncated: z.boolean(), launchEnabled: z.literal(false), manifestRevision: text })
export const counts = z.object({ info: z.number(), low: z.number(), moderate: z.number(), high: z.number(), critical: z.number() })
export const auditFinding = z.object({ name: text, severity, range: text.optional(), title: text, url: text.optional(), fixAvailable: z.boolean().optional(), fixTarget: z.object({ name: text, version: text, isSemVerMajor: z.boolean().optional() }).optional(), patchedRange: text.optional(), direct: z.boolean().optional(), identifiers: z.array(text).optional(), suppression: z.object({ source: text, ids: z.array(text), reason: text.optional() }).optional() })
export const outdatedFinding = z.object({ name: text, current: text, wanted: text.optional(), latest: text, kind: dependencyKind.optional(), change: z.enum(['major', 'minor', 'patch', 'prerelease']), majorGap: z.number(), score: z.number() })
export const doctorFinding = z.object({ filePath: text, line: z.number(), column: z.number(), rule: text, plugin: text, severity: z.enum(['error', 'warning']), message: text, help: text, category: text, url: text.optional() })
export const categoryId = z.enum(['performance', 'accessibility', 'best-practices', 'seo'])
export const lighthouseAudit = z.object({ id: text, title: text, description: text, score: z.number().nullable(), scoreDisplayMode: text, categories: z.array(categoryId), displayValue: text.optional(), numericValue: z.number().optional(), numericUnit: text.optional(), explanation: text.optional(), details: z.object({ headings: z.array(z.object({ key: text, label: text })), items: z.array(z.record(z.string(), text)), omitted: z.number().optional() }).optional() })
const storage = z.object({ totalBytes: z.number().nonnegative(), nodeModulesBytes: z.number().nonnegative(), hasNodeModules: z.boolean(), measuredAt: text, partial: z.boolean() })
const baseReport = { availability, measuredAt: text.optional(), freshness: z.enum(['snapshot', 'changed', 'unknown']), completeness: z.enum(['complete', 'partial', 'unknown']), reportRevision: z.number().optional(), lastAttempt: z.object({ operationId: text, status: z.enum(['running', 'succeeded', 'failed', 'cancelled']), at: text, errorCode: text.optional() }).optional(), invalidation: z.object({ at: text, reason: text }).optional() }
export const reportSummary = z.object({ kind: reportKind, ...baseReport })
export const reportView = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('storage'), ...baseReport, report: storage.optional() }),
  z.object({ kind: z.literal('audit'), ...baseReport, report: z.object({ manager, scannedAt: text, counts, originalCounts: counts.optional(), warnings: z.array(text).optional() }).optional(), rows: page(auditFinding) }),
  z.object({ kind: z.literal('outdated'), ...baseReport, report: z.object({ manager, scannedAt: text, score: z.number(), level: z.enum(['current', 'low', 'moderate', 'high']) }).optional(), rows: page(z.discriminatedUnion('rowKind', [outdatedFinding.extend({ rowKind: z.literal('finding') }), z.object({ rowKind: z.literal('skipped'), name: text, reason: text })])) }),
  z.object({ kind: z.literal('unused'), ...baseReport, report: z.object({ scannedAt: text, knipVersion: text, warning: text.optional() }).optional(), rows: page(dependency.extend({ line: z.number().optional() })) }),
  z.object({ kind: z.literal('reactDoctor'), ...baseReport, report: z.object({ scannedAt: text, version: text, score: z.number().nullable(), label: text, warning: text.optional() }).optional(), rows: page(doctorFinding) }),
  z.object({ kind: z.literal('lighthouse'), ...baseReport, report: z.object({ scannedAt: text, version: text, requestedUrl: text, url: text, formFactor: z.enum(['mobile', 'desktop']), categories: z.array(z.object({ id: categoryId, title: text, score: z.number().nullable() })), warnings: z.array(text) }).optional(), rows: page(lighthouseAudit) }),
])
export const membership = z.object({ rootId: root, relativePath: text })
export const projectSummary = z.object({
  id, name: text, description: text, stack: z.array(text), truncatedFields: z.array(text), packageManager: manager, hasPackageJson: z.boolean(), rootMemberships: z.array(membership), selectedMembership: membership.optional(),
  matches: z.object({ fields: z.array(text), dependencies: z.array(dependency), omittedDependencies: z.number().int().nonnegative() }).optional(), visualGroupId: id.optional(), packageWorkspaceId: id.optional(), git: z.object({ branch: text.optional(), dirty: z.boolean().optional() }).optional(), devStatus: z.enum(['stopped', 'starting', 'running', 'error']), reports: z.array(reportSummary), scannedAt: text,
})
export const projectDetail = projectSummary.extend({ version: text.optional(), author: text.optional(), license: text.optional(), homepage: text.optional(), origin: text.optional(), aiInstructionFiles: z.array(text), relatedProjectIds: z.array(id), capabilities: z.object({ analysis: z.boolean(), development: z.boolean(), mutation: z.literal(false), disabledReason: text }), resources: z.array(text), dependencies: page(dependency).optional(), scripts: page(script).optional(), preview: z.object({ capturedAt: text, source: text, kind: text.optional(), url: text.optional() }).optional() })
export const rootSummary = z.object({ rootId: root, name: text, path: text.optional(), scanned: z.boolean(), scannedAt: text.optional(), projectCount: z.number(), notObservedCount: z.number(), warnings: z.array(text), completeness: z.enum(['complete', 'partial', 'unknown']) })
export const readme = z.object({ text, contentRevision: text, nextCursor: z.string().nullable(), truncated: z.boolean(), sourceTimestamp: text, available: z.boolean() })
export const operation = z.object({ operationId, helperInstanceId: text, requestId, kind: text, projectIds: z.array(id), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']), createdAt: text, startedAt: text.optional(), finishedAt: text.optional(), progress: z.object({ phase: text, detail: text.optional(), completed: z.number().optional(), total: z.number().optional() }).optional(), cancellation: z.literal('stop-after-current'), cancelRequested: z.boolean(), resultKind: text.optional(), resultAvailable: z.boolean(), error: z.object({ code: text, message: text }).optional() })
export const commit = z.object({ hash: text, author: text, email: text, committedAt: text, message: text })
export const branch = z.object({ ref: text, name: text, remote: z.boolean() })
export const history = z.object({ available: z.boolean(), shallow: z.boolean(), from: text, to: text, section: z.enum(['commits', 'branches', 'authors', 'activity']), rows: page(z.union([commit, branch, z.object({ name: text, email: text }), z.object({ date: text, count: z.number() })])) })
export const pushStatus = z.object({ available: z.boolean(), hasOrigin: z.boolean(), originRefsKnown: z.boolean(), unpushedCommits: z.number(), dirty: z.boolean(), shallow: z.boolean(), checkedAt: text })
export const processGeneration = z.string().regex(/^proc_[a-f0-9-]{36}$/)
export const devStatus = z.object({ status: z.enum(['stopped', 'starting', 'running', 'error']), url: text.optional(), error: text.optional(), owned: z.boolean(), processGeneration: processGeneration.optional() })
export const devLogs = z.object({ text, processGeneration: processGeneration.optional(), truncated: z.boolean(), resetRequired: z.boolean(), snapshotAt: text, nextCursor: z.string().nullable() })
export const operationRow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('development'), projectId: id, action: z.enum(['start', 'stop']), dev: devStatus }),
  z.object({ kind: z.literal('check'), projectId: id, check: reportKind, report: reportSummary, resource: text }),
  z.object({ kind: z.literal('preview'), projectId: id, capturedAt: text.optional(), source: text.optional(), resource: text.optional() }),
  z.object({ kind: z.literal('scan'), root: rootSummary }),
  z.object({ kind: z.literal('repository'), projectId: id, available: z.boolean(), shallow: z.boolean(), commits: z.number(), error: text.optional() }),
  commit.extend({ kind: z.literal('commit'), projectId: id, branches: z.array(branch) }),
  z.object({ kind: z.literal('cancelled'), remaining: z.number() }),
])
export const operationResult = z.object({ operation, rows: page(operationRow), pollingIntervalMs: z.number() })
export const finding = z.object({ id: text, projectId: id, kind: z.enum(['security', 'outdated', 'reactDoctor']), title: text, description: text, priority: z.enum(['critical', 'high']), scannedAt: text, findingKeys: z.array(text), findingKeysOmitted: z.number() })
export const findings = z.object({ rows: page(finding), dismissalsAvailable: z.literal(false), scoringPolicy: text })
export const serverInfo = z.object({ appVersion: text, schemaVersion: z.literal(1), protocols: z.array(text), helperInstanceId: text, platform: text, capabilities: z.array(text), supportedChecks: z.array(text), limits: z.object({ pageSize: z.number(), responseBytes: z.number(), readmeBytes: z.number(), imageBytes: z.number(), logBytes: z.number(), logSnapshotBytes: z.number() }), stateLifetime: text, browserDataAvailable: z.literal(false), contentDisclosure: z.boolean(), pathDisclosure: z.boolean() })
export const envelope = <T extends z.ZodType>(data: T) => {
  const base = { schemaVersion: z.literal(1), helperInstanceId: text, revision: z.number().int(), observedAt: text, warnings: z.array(warning) }
  return z.union([
    z.object({ ...base, outcome: z.enum(['ok', 'accepted']), data }),
    z.object({ ...base, outcome: z.literal('error'), error: z.object({ code: text, message: text, retryable: z.boolean() }) }),
  ])
}
