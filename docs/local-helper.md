# Local helper architecture

The helper gives the browser access to local repositories, Git, package managers,
development processes, and preview capture. It is a separate Express process,
not part of the static frontend build. Shared response models live in
[`src/types.ts`](../src/types.ts). The scan exposes its root path and relative
project paths; authoritative action directories and process handles stay in
server-side `RegisteredProject` and `ProjectRuntime` state.

## Entry points and request flow

[`scripts/app.mjs`](../scripts/app.mjs) serves the built browser app and starts
the helper for daily use. [`scripts/dev.mjs`](../scripts/dev.mjs) starts Vite
with hot reload and the helper for development. Both use
[`scripts/start.mjs`](../scripts/start.mjs) to stop both children on shutdown
or when either exits. [`server/index.ts`](../server/index.ts) listens on
`127.0.0.1:4318`, handles startup errors, and calls `application.shutdown()` on SIGINT
or SIGTERM. `npm run helper` starts only this process.

[`createApp()`](../server/app.ts) creates a fresh Express app and shared helper application containing the registry,
runtime, root index, operation coordinator, and workspace map. Returning these objects separately allows tests to
exercise HTTP behavior without the production listener. The Vite development
and daily-use servers proxy `/api` to the helper on port 5180; the standalone
preview uses port 4173 ([configuration](../vite.config.ts)).

The normal flow is:

1. [`scanWithHelper()`](../src/lib/api.ts) posts an absolute folder path to `/api/scan`.
2. [`scanDirectory()`](../server/scanner.ts) returns serializable project metadata
   plus internal registrations containing canonical directories.
3. The app registers those entries and records them under the canonical root path.
4. Subsequent project actions send a project ID. Routes resolve that ID through
   the registry before calling a runtime operation or Git service.
5. Service results update the in-memory project where applicable and return to
   the browser, which owns its own workspace state and persistent cache.

Project IDs are the first 20 hexadecimal characters of the SHA-256 hash of the
canonical project directory. They remain stable across scans at the same path;
moving a repository changes its ID.

## API groups

Routes and response envelopes are defined in [`server/app.ts`](../server/app.ts).
Project paths below are relative to `/api/projects/:id`.

| Scope | Endpoints | Owner |
| --- | --- | --- |
| Helper and discovery | `GET /api/health`, `POST /api/scan` | App and scanner |
| Change detection | `POST /api/package-changes` | Workspace map and fingerprints |
| Process state | `GET /status`, `GET /logs`, `POST /start`, `POST /stop` | Runtime |
| Git reads | `POST /history`, `/daily-summary`, `/push-status` | Git services |
| Package analysis | `POST /audit`, `/outdated`, `/unused`, `/react-doctor` | Runtime and package services |
| Frontend analysis | `POST /lighthouse` | Runtime and Lighthouse service |
| Dependency changes | `POST /update-packages`, `/fix-vulnerability`, `/delete-node-modules` | Runtime and maintenance services |
| Storage | `POST /storage` | Runtime and storage service |
| Preview | `POST /screenshot`, `GET /api/screenshots/:filename` | Runtime and preview services |
| Desktop integration | `POST /open`, `/run-script` | Runtime and script service |

`HelperError` carries an HTTP status and a user-facing message. Unknown errors
are logged by the helper and returned as a generic 500 response. Invalid JSON
gets a 400 response; JSON bodies are limited to 16 KB. Keep response types in
[`src/types.ts`](../src/types.ts) aligned with service and client changes.

## Live scan progress

Discovery, storage, audit, outdated, unused, React Doctor, Lighthouse, and preview
requests accept `Accept: application/x-ndjson` for optional progress streaming.
[`scan-progress.ts`](../server/scan-progress.ts) sends newline-delimited
`progress` frames carrying `ScanProgress`, then a `result` frame containing the
original response envelope. Errors after streaming starts use an `error` frame
with the message and HTTP status; errors before the first frame retain their
normal HTTP response. Clients that do not opt in continue receiving JSON.
Existing origin, host, header, and registered-project checks apply to both.

Runtime's deduplicated operation promises share the latest stage and subsequent
updates with subscribers. The operation is reserved before asynchronous work;
subscriptions are released on completion. A slow reader can miss intermediate
updates, and disconnecting a client does not cancel shared work or its cleanup.
REST streams have no persistent job store; the optional MCP service has bounded
in-memory operation polling for metadata discovery and daily Git summaries.

Services report actual preparation, registry, analysis, validation, and cleanup
milestones. React Doctor's JSON mode suppresses terminal progress, so the helper
adds a child-only observer for recognized worker starts and the scoring request.
Its fixed tokens distinguish code analysis and score retrieval without changing
the report or exposing raw output. Concurrent lint and code analysis are labeled
accordingly; unrecognized future worker names do not invent progress.
Lighthouse maps its own status events to page loading, data collection, audits,
and scores. The bounded parser in
[`scan-worker-progress.ts`](../server/scan-worker-progress.ts) accepts only known
tokens and removes them from report diagnostics. Metadata and disk traversal
report the current work while retaining their existing discovery limits.

## Discovery, registration, and fingerprints

[`server/scanner.ts`](../server/scanner.ts) recognizes Git checkouts, JavaScript
packages, and several language manifest markers. It reads bounded metadata,
READMEs, recognized AI instruction filenames, and local Git state. Parsing and
workspace matching are shared with browser discovery through
[`metadata.ts`](../src/lib/metadata.ts) and [`monorepo.ts`](../src/lib/monorepo.ts).
Scanning does not install dependencies, start scripts, or resolve remote previews.

Discovery uses batches of eight folders with limits of 500 folders and 300
projects. General collection traversal reaches depth two. Inside a project it
automatically checks direct children; deeper discovery follows declared workspace
patterns, bounded to eight levels per workspace context. Hidden directories,
generated directories, and directory symlinks are skipped. Traversal limits,
unreadable folders, and parse failures produce scan warnings; unavailable or
oversized metadata files can be silently omitted.

Declared workspace members inherit the workspace package manager and record a
`workspaceDirectory`. Members without their own `.git` inherit parent Git
metadata; nested Git checkouts are separate repositories. Direct child packages
can be shown as monorepo members without being declared workspace members, so
`monorepo` display membership alone does not imply shared package operations.

`ProjectRegistry.register()` preserves the existing mutable `RepoProject` object
when a project is rescanned. This keeps process ownership and previously captured
previews and reports attached to the same object. Registration is additive;
projects absent from a subsequent scan are not pruned from the registry.

[`package-fingerprint.ts`](../server/package-fingerprint.ts) hashes stat metadata
for a fixed list of manifests, lockfiles, package configuration files, and
`.trivyignore` / `.trivignore`. It
does not hash file contents or traverse dependencies. Declared workspace members
combine their fingerprint with their workspace parent's fingerprint.
`/api/package-changes` computes fingerprints only for the latest registrations
of the requested root; an unknown root returns `fingerprints: null` so the client
can register again after a helper restart.

## Runtime services

[`ProjectRuntime`](../server/runtime.ts) coordinates operations and owns their
in-flight promises, child processes, cached reports, logs, browsers, and PNGs.
Individual service modules handle command construction, validation, and parsing.

- **Development servers:** [`dev-server.ts`](../server/dev-server.ts) combines the
  selected `dev`, `start`, or `serve` script with supported framework flags. It
  shares the pure command tokenizer in [`dev-script.ts`](../src/lib/dev-script.ts)
  with Lighthouse eligibility so quoted arguments and environment assignments
  are interpreted consistently without executing shell expressions. It
  honors explicit script configuration and supplies loopback host/port defaults
  where supported. Runtime launches the package manager with argument arrays and
  `shell: false`, checks configured/logged loopback URLs for up to 45 seconds, and
  keeps the last 40,000 log characters. Stop invalidates pending starts, sends
  SIGTERM, then SIGKILL after two seconds. Generation counters prevent stale
  starts from overwriting a newer stop/start. A separate `proc_` token is allocated
  synchronously for each new pending start and remains stable across joined or
  repeated starts. Runtime stop compares an optional expected token before any
  signal or await. REST callers retain current-process stop behavior; MCP requires
  the token. Selected startup scripts are revalidated against the current manifest.
  Lifecycle changes advance the application revision, including unexpected exits
  and pre-launch failures. Local starts are unsupported on Windows.
- **Git:** [`git-history.ts`](../server/git-history.ts),
  [`git-daily-summary.ts`](../server/git-daily-summary.ts), and
  [`git-push-status.ts`](../server/git-push-status.ts) read local Git data with
  bounded subprocesses. History streams NUL-delimited records. Git commands
  disable hooks/fsmonitor and terminal prompts; push status compares existing
  local refs without fetching or pushing.
- **Package reports:** [`package-audit.ts`](../server/package-audit.ts) and
  [`package-outdated.ts`](../server/package-outdated.ts) invoke the installed
  package manager, validate supported report formats, and use temporary caches
  where configured. They perform explicit registry checks without installing or
  fixing dependencies. [`package-unused.ts`](../server/package-unused.ts) runs
  this app's installed Knip across the workspace and filters findings to the
  selected manifest. [`react-doctor.ts`](../server/react-doctor.ts) runs this app's
  installed React Doctor on the selected project and validates its report version,
  project identity, completeness, and counts. These tools can load project config.
  Audit suppression is handled by [`audit-ignore.ts`](../server/audit-ignore.ts)
  and [`audit-suppressions.ts`](../server/audit-suppressions.ts). Regular ignore
  files are read only from `workspaceDirectory ?? directory`, bounded to 64 KB
  each with no-follow opens. CVE/GHSA IDs and optional UTC expiry dates are
  matched against structured advisory identifiers. Missing CVE aliases can be
  resolved through unauthenticated, redirect-free requests to GitHub's fixed
  public advisory endpoint (40 IDs, four workers, ten seconds total, 256 KB per
  response). Failures add report warnings and leave unmatched findings active.
  npm package causes are retained internally to distinguish mixed advisories and
  propagate full suppression only through proven dependency causes; unresolved
  cycles and missing references remain active. Returned `counts` exclude matched
  suppressions, `originalCounts` retains the manager summary when changed, and
  findings retain suppression provenance. Unknown summary-only counts remain
  active. Ignore decisions are dated audit snapshots, not metadata scan results.
- **Package updates:** [`package-update.ts`](../server/package-update.ts) resolves
  eligible stable registry versions before installing minor or patch updates.
  It skips peer dependencies, ambiguous declarations, and unsupported ranges,
  rechecks the original manifest before mutation, and disables lifecycle scripts.
  Installs may partially succeed; related projects' package/storage reports are
  invalidated and dependency metadata refreshed even if an install fails.
  The separate `fix-vulnerability` action uses
  [`package-audit-fix.ts`](../server/package-audit-fix.ts) to accept an audited
  finding identity, recheck it with a fresh audit, and resolve a supported declared
  dependency or an audit-reported direct parent. It only installs a stable
  compatible fix within the target's current major version, pins the exact
  version, and disables lifecycle scripts. Unsupported targets and fixes requiring
  a major upgrade do not install. The operation uses the same related-project
  maintenance guards and report invalidation; the client requests a fresh audit
  after metadata refresh to report remaining findings. Ordinary audits and
  automatic scans never invoke this mutation.
- **Storage:** [`project-storage.ts`](../server/project-storage.ts) measures
  allocated bytes, counts hard links once, and excludes symlink targets. Its
  250,000-entry, 128-level, and 20-second limits produce `partial` results. Cleanup
  requires `confirm: true` and removes only the selected project's real root-level
  `node_modules` directory, then measures storage again.
- **Desktop actions:** `open` validates an application ID against the shared
  [`desktop-apps.ts`](../src/lib/desktop-apps.ts) catalog, revalidates the directory
  through `ProjectRegistry.get()`, and checks the runtime maintenance/shutdown
  guard before delegating to [`desktop-apps.ts`](../server/desktop-apps.ts).
  Launchers use fixed executable names and argument arrays without a shell;
  requests cannot supply a command or directory. macOS uses a bounded `open`
  process; Linux and Windows require the launcher/executable on the helper's
  `PATH`. Desktop processes are detached, like script terminals, and belong to
  the user rather than the helper's development-server lifecycle. A successful
  spawn acknowledges the launch request, not the application's subsequent UI
  state. Missing executables and unsupported platforms produce setup guidance.
  [`project-scripts.ts`](../server/project-scripts.ts) checks the requested script
  name and displayed command against both registered metadata and a fresh regular
  `package.json`, then launches the package-manager script in the configured terminal.
  The optional `terminal` request field is validated against the shared terminal
  catalog; omission preserves Automatic (macOS Terminal or Linux fallback).
  Explicit choices never fall back to another app. Terminal and iTerm2 use bounded
  AppleScript with shell text passed only as an argument; other macOS launchers
  use `open -n -a ... --args`, and Linux launchers use fixed argument arrays.
  Shells remain open after CLI-launched tasks finish. Unsupported platforms or
  missing launchers report setup guidance. Windows script launching remains unsupported.
  Paths and names are quoted; browser-supplied script bodies are never interpolated.
  Terminal scripts run independently and are not tracked as runtime dev servers.

## Lighthouse pipeline

[`lighthouse.ts`](../server/lighthouse.ts) validates the registered project's
current bounded, regular package manifest with a no-follow open. The selected
frontend script and explicit preview URL must still match scanned metadata.
[`lighthouse.ts`](../src/lib/lighthouse.ts) supplies shared eligibility; generic
homepage URLs and library dependencies do not opt projects in.

Runtime reserves the Lighthouse operation before filesystem awaits, checks
related workspace maintenance and preview operations, and reuses the existing
dev-server lifecycle. An explicit preview URL takes precedence over local
startup. Temporary servers stop in cleanup unless an explicit start claims
them; previously persistent servers remain running. Fresh Playwright Chromium
is owned by the runtime, bound to a loopback debugging port, and checks that the
target serves successful HTML without a recognized framework build-error overlay.

[`lighthouse-worker.mjs`](../server/lighthouse-worker.mjs) runs the installed
Lighthouse Node API in a bounded subprocess against that browser using the desktop
preset and the four performance, accessibility, best-practices, and SEO categories.
It cannot start a replacement browser. The worker has a two-minute deadline and
16 MiB output limit; startup, Chromium launch, and HTML preflight have separate
bounds. Lighthouse is pinned to 12.8.2 to retain the Node 22.12 minimum. Only the
helper imports the package; it never enters the browser bundle.

The service checks report version, requested URL, category coverage, audit
references, and score ranges. Fatal runtime errors fail the action. Partial audits
retain null scores, explicit modes, and warnings. Stored report rows are bounded
text; raw report HTML, screenshots, and traces are omitted. Successful reports
are preserved by registry rescans; failures keep the last report, and package
update attempts invalidate related reports. Shutdown aborts the worker and closes
Chromium, including browsers whose launch was already pending.

## Preview pipeline

Preview orchestration lives in [`runtime.ts`](../server/runtime.ts). `auto` tries
an explicit `localRepos.previewUrl`, a local application, package homepage, then
the public GitHub repository homepage setting. `local` omits remote page targets;
`website` omits local startup and repository assets. Target normalization and the
unauthenticated GitHub lookup live in
[`preview-sources.ts`](../server/preview-sources.ts).

Each capture lazily launches headless Playwright Chromium.
[`preview-renderer.ts`](../server/preview-renderer.ts) uses fresh browser contexts,
bounded rendering, blank-image detection, and build-error checks. If eligible
pages fail, [`preview-assets.ts`](../server/preview-assets.ts) discovers bounded
Open Graph images, logos, and favicons, and
[`preview-asset-renderer.ts`](../server/preview-asset-renderer.ts) renders them.
Repository assets stay within canonical paths and skip symlinks; remote assets
use unauthenticated requests with bounded reads and validated redirects.

A successful capture stores one PNG per project in a temporary helper directory
and returns an `/api/screenshots/<id>.png` URL plus preview provenance. A capture
stops only the temporary server it owns. Explicitly starting that server during
capture keeps it alive; cleanup never stops a replacement process. Browsers close
in `finally`, including failed captures.

## Concurrency and safety contracts

Runtime deduplicates concurrent starts, captures, and report scans per project.
Capture deduplication is by ID, so simultaneous requests with different preview
modes share the first pending capture. Dependency updates and removal acquire a
maintenance reservation before filesystem awaits. Runtime checks
`registry.related(id)` for running/starting/stopping servers, captures, storage
scans, and package scans before permitting maintenance. Related entries share
the same `workspaceDirectory ?? directory`; do not replace this grouping with
display-only monorepo membership. External processes and launched script terminals
are outside these guards.

The request boundary in [`app.ts`](../server/app.ts) requires a loopback `Host`,
rejects unapproved `Origin` values and `Sec-Fetch-Site: cross-site`, and requires
`X-Local-Repos: 1` on methods other than GET/HEAD. Default origins cover local UI
ports; `LOCAL_REPOS_UI_ORIGIN` adds one origin unless `createApp` supplies an
explicit list. Responses set `no-store` and `nosniff`. Preserve these checks when
adding endpoints; the helper is intended to run locally against trusted projects.

Filesystem actions resolve registered IDs through `registry.get()`, which
revalidates canonical project/workspace paths within the scanned root.
`registry.lookup()` deliberately skips filesystem access for process status,
logs, and stop, allowing a known process to be stopped after its folder moves.
Storage deletion additionally rechecks directory identity and rejects symlinks.
These checks do not synchronize unrelated external filesystem mutations.

## State lifetime

Registry entries, scanned-root maps, runtime state, logs, and report objects live
only for the helper process. Completed operation promises are removed; report
values remain on registered projects. The helper has no database or durable job
queue. Browser persistence is a separate concern.

After restart, [`src/lib/api.ts`](../src/lib/api.ts) can lazily rescan the connected
root and retry an action once when a project is unknown. Background status polling
does not trigger that registration. Shutdown rejects new guarded work, terminates
owned dev processes, closes browsers, waits for in-flight captures and maintenance
or report operations, then removes temporary preview files.

## Optional MCP read service

[`application.ts`](../server/application.ts) owns the registry, runtime, scanned
root memberships, boot ID, revisions, and [`operations.ts`](../server/operations.ts).
Both REST scans and MCP discovery use this service. `createApp()` returns it as
`application` alongside the existing `app`, `registry`, and `runtime` properties.
Shutdown closes runtime resources, rejects new work, and waits for discovery
and admitted operations. The static app and Vite proxy do not expose `/mcp`.

MCP is absent unless `LOCAL_REPOS_MCP_CONFIG` names a valid, owner-only local
configuration file outside the configured roots. [`mcp/policy.ts`](../server/mcp/policy.ts)
canonicalizes roots, validates unique clients and credentials, and loads immutable
per-client grants. Defaults are `read`, `discovery`, and `git`; `analysis`,
`preview`, `network`, `project-execution`, and `development` require explicit configuration.
Restart to apply policy changes
or revoke credentials. README, preview, and log content disclosure defaults off;
absolute path disclosure defaults off. These settings are disclosure choices,
not a sandbox or a guarantee that repository text contains no secrets.

[`mcp/http.ts`](../server/mcp/http.ts) mounts an authenticated endpoint before the
REST-specific custom-header middleware, after the existing Host/Origin/cross-site
checks. Credentials are required on every request; REST still requires its
existing header. Parsing is limited to 16 KiB and each principal may have four
active HTTP requests. The official SDK supplies request codecs, modern serving,
and stateless 2025 compatibility. [`mcp/stdio.ts`](../server/mcp/stdio.ts) bridges
SDK calls to the running helper, with no separate application/runtime. It accepts
only a literal `127.0.0.1` HTTP endpoint and refuses redirects and other origins.

[`project-index.ts`](../server/project-index.ts) projects only current memberships
of the caller's configured roots. Each canonical project can have several
root-relative memberships. Missing projects are marked not observed, with a
last-seen timestamp retained internally; they disappear from normal MCP lists
without deleting existing registry/process ownership. A root summary reports
unobserved counts and scan warnings, so a limited scan does not assert deletion.
Unscanned roots differ from successfully empty scans. Unknown and unauthorized
project IDs both return `PROJECT_NOT_FOUND`.

The registry preserves known parent package/Git context across narrower scans.
Git directories and package workspace directories are separate internal fields.
Context changes cannot commit while the affected old or new workspace is busy.
A global discovery reservation serializes scans and prevents package maintenance
from racing registration. Metadata reads do not run project code. Git reads
revalidate the effective repository against the caller's grants, disable lazy
fetches, and preserve exact author/ref matching and shallow/unknown-ref states.
Daily operations deduplicate canonical repository roots and read one repository
at a time (the existing service uses at most three ref readers).

Tools and resources use the schemas in [`mcp/schemas.ts`](../server/mcp/schemas.ts).
Defaults are 25 rows, maximum 100, with an adaptive byte budget. Signed cursors
bind principal, boot, query, revision, and projected content; Git cursors also
bind current refs. README cursors bind sanitized content and UTF-8 byte offsets.
Responses include both validated structured data and compatibility text, together
limited to 128 KiB. README chunks are at most 32 KiB; explicit preview resources
are limited to 2 MiB. Oversized individual rows are errors rather than silent
omissions. Project summaries identify truncated metadata fields; script rows
identify truncated commands. URL userinfo, common credential query parameters,
and terminal controls are removed on output, with best-effort secret protection.

The read catalog includes server/root/project metadata, dependency/script pages,
README chunks, report summaries/rows, actionable findings, Git history/day/push
reads, and operation polling/cancellation. Resources expose matching metadata,
reports, READMEs, previews, and authorized operation status. Optional `run_check`
and `capture_preview` tools use the shared runtime. There are also status/log reads and generation-safe dev start/stop tools. Desktop-launch
and script-launch MCP tools remain unavailable. Dependency maintenance requires
separate preparation and explicit locally granted application.

Report snapshots belong to the current helper. Reads distinguish missing,
unsupported, invalidated, and available reports; null scores, skipped declarations,
suppressions, partial storage, and warning information remain visible. REST report
attempts update helper attempt records even if the reader disconnects. Failed
reruns preserve the prior report. Changed package fingerprints and report removal
produce helper-lifetime invalidations; successful replacement reports supersede
them. Fingerprints do not prove freshness. Reading a report never runs a check.
Findings use the shared todo rules and default outdated scoring, without claiming
access to browser dismissals, settings, or tags.

Operation admission reserves `(principal, requestId)` before work and binds it to
the normalized request. There is one active operation per principal, except that
exact-generation stops may interrupt pending work. At most 100 work items may
be admitted across the helper. Terminal records retain results for
30 minutes, up to 200 records/32 MiB, with an 8 MiB per-result cap. Compact retry
keys persist for the helper lifetime, capped at 10,000; expired admissions cannot
be replayed. Cancellation stops queued work or stops after the current repository;
completed work is still recorded as successful. Disconnecting never cancels an
admitted job. Terminal diagnostics log only operation ID, kind, project IDs,
duration, outcome, and invalidation count.

`POST /api/workspace-state` accepts strict `{ rootId, helperInstanceId?,
afterRevision? }` input under the normal REST security checks. It returns a full
root snapshot capped at 32 MiB, boot ID, revision, reset/registration flags,
warnings, and public active-operation projections without client credentials or
request IDs. Project `reportState` entries distinguish missing data from explicit
invalidations and carry boot/revision identities. Tombstones survive operation
expiry; package maintenance invalidates all related reports at one revision,
including failed attempts. Fresh successes supersede tombstones. REST reports and
metadata scans carry these markers too.

Checks require `analysis`; all except storage also require `network`. Unused,
React Doctor, and Lighthouse additionally require `project-execution`. Preview
capture requires `preview`, `network`, and `project-execution` for all sources.
Defaults remain read/discovery/Git only. These grants acknowledge effects rather
than sandboxing repository code. Admission and execution both check capability
and effective workspace scope, including registered related packages. Checks
reuse runtime task deduplication and progress. Preview deduplication requires an
identical source. Operations return compact summaries and resource links; report
contents retain existing pagination and limits. Optional MCP batches are deferred.
The protocol tests exercise official SDK HTTP and stdio clients under both
2026-07-28 and 2025-11-25. External host application interoperability and OAuth
flows have not been verified or advertised.


### Development control through MCP

`get_dev_status` and `read_dev_logs` use recorded directory ownership rather than
current scan membership or filesystem checks, preserving access after a directory
moves. This exception does not authorize a new launch. Reads require `read` or
`development`; logs additionally require `discloseContent`. Startup requires
`development`, `network`, and `project-execution`, validates the effective workspace
and related packages, and runs through the same runtime as REST and previews.
Stop requires `development` and an exact process-generation token, checked inside
the runtime atomically. It may be admitted while that principal has a pending
start. Cancellation alone never kills shared startup work. Startup completion
requires the observed generation to remain running; stop results describe the
signalled generation, not any replacement that starts before the response arrives.

[`mcp/dev.ts`](../server/mcp/dev.ts) retains at most 32 sanitized log snapshots,
one per principal/project, capped at 64 KiB each and expiring after five minutes.
Pages are UTF-8 aligned, at most 16 KiB, and frozen across appends. Cursors bind
the principal, project, generation and snapshot. Expired/incompatible cursors
require a fresh first read; a valid cursor across a process replacement returns
`resetRequired: true` with the new generation. Fresh reads refresh the retained
tail. Runtime logs retain at most 40,000 characters, are reset for new starts,
and cannot receive late output from an older child. Redaction remains best-effort.

### Reviewed maintenance through MCP

[`mcp/maintenance-plans.ts`](../server/mcp/maintenance-plans.ts) is owned by the
shared application, not request-scoped MCP adapters. `maintenance` enables
preparation; package update/fix preparation and application also require `network`.
The client's optional `maintenanceAutomation` array explicitly authorizes the
listed kinds (`package-update`, `vulnerability-fix`, `dependency-cleanup`) under
its existing root grants. Without it apply tools are absent. This is local scoped
automation authorization, not verification of a host UI approval gesture.

Package services now separate `preparePackageUpdate` / `prepareAuditFix` from
`applyPackageUpdate`; existing REST entry points compose these same services.
Preparation resolves stable same-major exact direct targets and preserves skips,
version bounds and audit-finding validation. Application accepts no replacement
versions and performs no new version resolution. Fixed install arguments and
environment retain disabled lifecycle scripts and pnpm hooks.

`ProjectRuntime.withMaintenance()` reserves synchronously before filesystem
validation, shares existing related-project/process/scan guards, and remains
tracked through shutdown. Both prepare and apply use it. The plan service checks
every effective workspace and registered related package against the client's
current authority. [`maintenance-preconditions.ts`](../server/maintenance-preconditions.ts)
hashes the known manifest, lock, package configuration, PnP, and ignore-file
contents across that scope, including absent inputs, manager/workspace context,
and canonical directory identities. Reads are no-follow and bounded to 8 MiB per
file / 32 MiB per pass. Cleanup additionally binds the actual root `node_modules`
identity and checks it again inside the removal service immediately before removal.
These checks coordinate helper clients; they do not lock out unrelated OS processes.

Preparation snapshots before and after resolution or measurement. Plans expire in
ten minutes and retain immutable internal targets independently of public result
objects. Revalidation and single-use consumption happen inside the maintenance
reservation. Plan output is capped at 12 KiB / 100 targets and rejects truncation;
retention is ten plans per principal, 100 overall, and 32 MiB including internal
inputs. No plan survives restart. Request deduplication remains in `Operations`,
so even a consumed or expired plan cannot cause an identical admitted request to
run a second time while its operation record is retained.

`OperationResultFailure` preserves typed partial outcome rows on failed mutations.
Results report attempted groups, groups whose subprocess completed, cleanup
attempts, fresh cleanup measurement when available, invalidated project/report
IDs, and unknown state. This does not verify installed transitive dependencies or
run a follow-up audit. The runtime invalidates all six reports across the related
workspace after any attempted install/removal, including partial failures, then
refreshes dependency metadata. Browser snapshots expose the same tombstones.
Active cancellation is stop-after-current; neither cancellation nor failure
promises rollback. Stale plans fail before mutation and need fresh preparation.

## Public issues and pull requests

`POST /api/projects/:id/remote-activity` runs a separate public API check through
[`remote-activity.ts`](../server/remote-activity.ts). Metadata discovery remains
local. It resolves only registered projects through `ProjectRegistry.get()` and
recognizes GitHub.com and GitLab.com origins, including SSH origins and GitLab
subgroups. Unknown hosts, enterprise/self-managed hosts and other providers are
unsupported. Requests use fixed HTTPS API hosts, omit credentials and cookies,
and reject redirects; local Git/CLI credentials are never read.

GitHub's issue collection includes pull requests, which the service separates.
GitLab uses distinct issue and merge request collections with `scope=all`.
Pagination uses locally constructed page numbers, never server-provided URLs.
A check has a 45-second deadline, 20-page limit per collection (100 items per
page), and 4 MiB response limit per page. It publishes a report only after all
collections finish. Inaccessibility, rate limits, malformed responses, timeouts,
and truncation fail explicitly and preserve prior dated counts.

A runtime-owned `RemoteActivityRateLimits` tracks one cooldown per provider across
all issue/PR checks, including different repositories and tabs. It uses
`x-ratelimit-remaining`, `x-ratelimit-reset`, and `Retry-After`, and inspects at most
16 KiB of an error body to recognize secondary-limit messages without displaying
upstream content. Confirmed exhaustion returns an explicit reset/retry timestamp
in UTC and prevents further outbound checks until that time (with a one-second
margin for header deadlines). Without a usable deadline it waits at least one
minute. A plain HTTP 403 is reported separately as access denial. Successful
responses that exhaust the quota remain usable; checks needing more pages fail
without publishing partial counts. Cooldowns are in-memory, scoped to the helper
lifetime; restarting does not reset provider-side quotas. The scanner avoids an
extra empty-page request when provider pagination explicitly signals completion.

The runtime reserves the check before filesystem awaits, coordinates it with
metadata scans and related-package maintenance, coalesces same-project requests,
and aborts owned network requests during shutdown. The browser report participates
in revisioned workspace snapshots; package report invalidations exclude remote
activity. MCP analysis/report schemas are unchanged and do not expose this new
check. The public API contracts are documented by
[GitHub](https://docs.github.com/en/rest/issues/issues) and
[GitLab](https://docs.gitlab.com/api/issues/).
