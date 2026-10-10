# Frontend architecture

The frontend is a React single-page application built with Vite. It displays one
connected workspace at a time, with a sample workspace when no directory is
connected. Navigation between projects, daily summary, and todos is React state;
there is no client-side URL router.

## Entry point and module boundaries

[`src/main.tsx`](../src/main.tsx) mounts `App` in React Strict Mode and loads
[`src/index.css`](../src/index.css). [`src/App.tsx`](../src/App.tsx) wraps the
workspace UI in `SettingsProvider` and composes the feature components and hooks.
[`src/types.ts`](../src/types.ts) defines the shared project, workspace, scan, Git,
and maintenance-report contracts used by both the frontend and helper.

| Area | Responsibility and entry points |
| --- | --- |
| Workspace shell | Sidebar, topbar, connection/help dialogs, scan toolbar, and notices in [`src/components`](../src/components). `App` supplies their data and callbacks. |
| Project browsing | [`use-project-filtering.ts`](../src/hooks/use-project-filtering.ts) owns filters, search, sorting, and the current page. [`project-results.tsx`](../src/components/project-results.tsx) renders flat grid results or monorepo groups in list view, and [`project-card.tsx`](../src/components/project-card.tsx) renders each project. Grid subpackages use directory-path titles and dashed card borders. |
| Project details | [`project-detail-dialog.tsx`](../src/components/project-detail-dialog.tsx) composes focused project tabs; controls delegate actions back to `App`. |
| Workspace operations | [`use-workspace-actions.ts`](../src/hooks/use-workspace-actions.ts) handles helper actions, maintenance batches, automatic scans, result merging, and notices. |
| Automatic work | [`use-workspace-watcher.ts`](../src/hooks/use-workspace-watcher.ts) schedules scans; [`use-push-reminder.ts`](../src/hooks/use-push-reminder.ts) schedules Git push-status checks. |
| Summary and todos | [`use-daily-summary.ts`](../src/hooks/use-daily-summary.ts) loads Git activity; [`use-project-todos.ts`](../src/hooks/use-project-todos.ts) derives actionable findings and reconciles dismissals. |
| Data access | [`api.ts`](../src/lib/api.ts) calls the helper; [`filesystem.ts`](../src/lib/filesystem.ts) scans browser directory handles; [`storage.ts`](../src/lib/storage.ts) owns IndexedDB access. |
| Domain logic | [`src/lib`](../src/lib) contains parsing, monorepo matching, grouping, filtering, scoring, tag normalization, configuration matching, and report formatting. Keep reusable transformations here rather than inside rendering code. |
| UI primitives and styles | [`components/ui`](../src/components/ui) wraps buttons and Radix dialogs/menus. Global layout lives in `index.css`, feature styles beside their components, and color variables in [`theme.css`](../src/theme.css). |

## Runtime modes

| Mode | Data source | Capabilities |
| --- | --- | --- |
| Demo | [`demo.ts`](../src/lib/demo.ts), used after cache restoration confirms no saved workspace | Sample projects and browsing; helper actions prompt the connection flow. |
| Browser directory | File System Access API directory handle | Read-only discovery and metadata, packages, README, and limited Git information. It cannot run scripts or maintenance commands. |
| Local helper | Same-origin `/api` requests proxied to the Node helper | Full scans, Git queries, processes, previews, package maintenance, storage actions, and application/terminal shortcuts. |
| Hosted deployment | Demo or browser directory access | Helper connection controls are replaced with local-install guidance; the startup helper health probe is skipped. |

Hosted deployment is a frontend capability restriction, not a third `Workspace.mode`.
[`deployment.ts`](../src/lib/deployment.ts) recognizes the Vercel build flag and
`.vercel.app` hosts, with explicit loopback-host exceptions. The connect dialog
offers the directory picker only when the browser exposes it.

The browser scanner requests read permission, limits file reads and directory
traversal, and returns warnings for unreadable or unsupported metadata. Manual
resync may request renewed permission; background scans only check permission.
Metadata parsing and declared-workspace matching are shared through
[`metadata.ts`](../src/lib/metadata.ts) and [`monorepo.ts`](../src/lib/monorepo.ts).

## State and data flow

`WorkspaceApp` owns the current `Workspace`, favorites, tags, connection state,
selected project/tab, grid/list view, operation status, logs, and notices. The
settings context owns validated application settings. Feature hooks own their
derived data, schedules, request state, and batch progress; there is no external
state-management library.

On startup, `App` restores the workspace, favorites, and tags independently from
IndexedDB. Until the workspace read succeeds, demo projects and labels remain
hidden behind a loading or cache-error state. A failed preference read does not
prevent a saved workspace from appearing. The app registers the cached helper root
with `api.ts`; visible helper-state polling re-registers it when the helper has
restarted or older cache data lacks root identity. Version refs prevent an older cache load from
replacing a newer connection or favorite edit. Readiness flags keep configuration
imports and tag editing from racing initial preference restoration.

The rendering pipeline is:

1. Take scanned projects from the workspace, or use demo projects only after
   confirming there is no saved workspace. While loading or on a workspace read
   error, use no projects.
2. Overlay tags from preferences and recalculate outdated-package scores using
   current settings. These display values do not replace the raw scan results.
3. Derive todo findings, filter groups, search matches, sorted results, and counts.
4. Render cards and details with callbacks to the operation coordinator.
5. Merge successful helper results into the current workspace and persist it.

`persist` updates React state before saving IndexedDB. A storage failure can leave
new results available for the current session with a visible cache warning.
Server-status polling updates live React state for starting/running projects; it
does not independently write each poll to IndexedDB.

Read-only Git views have separate request state. Project history keys requests by
project, branch, author, offset, and refresh revision. Daily summaries deduplicate
projects to their outermost repository and run at most three requests at a time.
They reject stale results when the selected day or workspace changes. Push
reminders also use up to three workers, defer while busy or hidden, and use the
browser's local day and configured reminder time.

## Workspace controls and project browsing

[`workspace-toolbar.tsx`](../src/components/workspace-toolbar.tsx) keeps directory
identity and workspace actions together. **Run checks** opens the existing Radix
menu for public repository activity, outdated packages, vulnerabilities, React
Doctor, and Lighthouse; preview capture remains a direct action. The menu explains
that checks include projects hidden by filters and preserves eligibility, helper
connection, and global busy guards. Selections use the same action callbacks and
batch progress panels as before. Keyboard dismissal restores focus to the trigger,
or to the labeled action group while a check has disabled the trigger.

Project count, resync, and watcher status share a compact metadata row. Unknown
report freshness appears as a **Cached reports** disclosure with guidance in an
overlay; opening it does not move the project list. Summary and todo pages retain
the full report notice. Search scope and query share an outlined control, followed
by sort/view controls and quiet quick-filter buttons with count badges. Controls
wrap on narrow screens without changing filtering or persisted preferences.

[`project-filters.tsx`](../src/components/project-filters.tsx) renders the full
filter panel with native single-select controls and Radix checkbox menus for
tags, technologies, and package managers. Multi-select menus keep selection live,
provide per-group clearing, and search lists longer than eight options without
hiding selected values. Search is local to each menu and resets on reopening.
Portaled menus keep long option lists out of the panel's scrolling layout;
Escape dismisses the menu before the panel and restores focus to its trigger.

## Search and command discovery

[`project-command-search.tsx`](../src/components/project-command-search.tsx)
extends the project toolbar with an accessible autocomplete list. It keeps the
project/action selection and keyboard cursor locally; normal query text still
belongs to `useProjectFiltering`. Project or action selection clears the library
query and narrows the suggestions. Changing workspace identity remounts the search
so a selection cannot carry into another directory. Suggestions always use all
current projects, including those hidden by library filters.

[`project-commands.ts`](../src/lib/project-commands.ts) describes available
operations, aliases, capabilities, and script payloads without executing them.
[`project-search.ts`](../src/lib/project-search.ts) combines that catalog with
project metadata, filter groups, workspace shortcuts, and dependency/version
completions. A memoized index prepares the catalog and normalized search fields
when projects, preferences, or filter options change; keystrokes reuse that index.
Script discovery reuses `discoverProjectScripts`; fuzzy and partial
matching never generates commands. The list renders suggestions in pages while
keeping all matches reachable by keyboard or the show-more control.

Selections delegate to `App` callbacks and the existing workspace action hook,
tag editor, settings trigger, and filter state. `App` resolves the selected
command against current project metadata before dispatch. Helper operations
retain connection, busy, batch, version, and watcher coordination; the helper
continues validating the script name and displayed command against the current
manifest. Cleanup and package mutation suggestions open existing review controls
and retain their confirmation behavior. No new API or durable search state is
introduced. Project and tag dialogs restore focus to the search opener.

## Cached header commit activity

[`use-commit-activity.ts`](../src/hooks/use-commit-activity.ts) retains only successful,
first-page, all-branch history activity supplied by `ProjectHistory` whose author
filter matches the optional `commitActivityAuthor` setting. Successful
helper connection, manual sync, and watcher sync also supply an explicit refresh
snapshot through `persist`. The hook reads history for deduplicated Git repositories
with at most three requests in flight, preserving prior reports on failure. It
also refreshes when the configured author changes, using an exact Git author-email
filter. It does not refresh on cache restoration, unrelated settings changes, or
report writes. New refresh snapshots and workspace changes cancel queued reads
and ignore late responses. The optional `commit-activity` preference in IndexedDB stores daily
counts, date coverage, shallow status, and cache timestamps for the most recently
cached workspace, scoped by connection mode, root, and author selection. Older
scopes without an author remain compatible with the all-authors default. It does not store commit
messages or author lists. Existing caches need no database version change.

[`commit-activity.ts`](../src/lib/commit-activity.ts) uses the summary repository
identity rules to avoid counting monorepo history twice and aggregates 13 calendar
weeks for [`global-commit-heatmap.tsx`](../src/components/global-commit-heatmap.tsx).
The topbar renders it only when valid cached activity exists for the current
workspace. Missing coverage stays distinct from known zero-count days; partial
repository or shallow coverage is labeled. Directory changes hide stale data
immediately, late callbacks are rejected, and cache-load results cannot replace
newer history. Forgetting the workspace clears this separate activity cache.

## Project details and action menus

The project dialog keeps the preview, metadata, and latest commit in **Overview**,
followed by disk usage and dependency cleanup. **History** contains the commit
log, and **Development** holds the server, scripts, preview capture, and logs.
**Packages** lists declared dependencies; **Vulnerabilities**, **Updates**, and
**Unused** contain the audit, outdated-package and minor/patch update controls,
and Knip reports.
Eligible projects also show **React Doctor** and **Lighthouse**; **README** remains
available for every project. `ProjectHistory` mounts only when **History** is
selected, so opening the overview does not load its commit log.

[`project-tabs.tsx`](../src/components/project-tabs.tsx) keeps readable labels in
a single horizontally scrolling row, reveals the active tab, and provides scroll
arrows when tabs overflow. Left/Right and Home/End keys retain tab selection and
focus navigation. Badge, alert, todo, and command destinations open the relevant
tab directly.

[`project-action-menu.tsx`](../src/components/project-action-menu.tsx) supplies the
same menu for grid and list cards. It reuses `projectCommands` eligibility and
labels for individual maintenance scans and development-server actions. Preview
capture exposes all three existing sources in a keyboard-accessible Radix submenu.
Actions delegate through the existing workspace action hook, preserving helper
connection prompts, busy checks, stale-response guards, caching, and notices.
An individual preview capture shows the same card progress badge as batch capture.

## Lighthouse frontend reports

[`lighthouse.ts`](../src/lib/lighthouse.ts) shares frontend eligibility between
the browser and helper: a recognized serving command in the selected startup
script or an explicit, normalized `localRepos.previewUrl`. Package dependencies,
homepages, and visual monorepo grouping alone do not establish a testable page.
The helper revalidates current metadata and the HTML response before auditing.
The toolbar and command search offer workspace scans; cards, action menus, and
the Lighthouse tab offer individual scans through `useWorkspaceActions`.

[`use-lighthouse-batch.ts`](../src/hooks/use-lighthouse-batch.ts) processes eligible
projects sequentially with stop-after-current, workspace generation checks,
failure details, and cache-write warnings. It participates in existing global
busy and watcher coordination. Reports are optional on older workspace snapshots,
survive rescans and failed reruns, and are invalidated after dependency update
attempts in their package workspace.

[`project-lighthouse.tsx`](../src/components/project-lighthouse.tsx) displays four
category scores, performance measurements, provenance, scan warnings, and
filterable audit details. Category scores use 0–100; audit scores retain
Lighthouse's 0–1 scale and explicit manual, informational, not-applicable, and
error modes. Missing data is never converted to a passing score. The card badge
specifically shows performance. Cached reports remain readable when a project
loses scan eligibility. Diagnostic rows contain bounded text and descriptions
render safe Markdown without raw HTML. Report content stays in the workspace
cache; there is no additional settings or database schema migration.

## Persistence and identity

| Storage | Contents | Identity |
| --- | --- | --- |
| IndexedDB database `local-repos`, store `preferences`, version 1 | `workspace`, `favorites`, `project-tags`, `commit-activity` | One workspace snapshot; favorite IDs and tag maps persist independently of disconnection. Browser snapshots include the directory handle. |
| `localStorage` | Settings, theme, todo dismissals, push-reminder dismissals | Keys and validation live in [`settings.ts`](../src/lib/settings.ts), [`use-theme.ts`](../src/hooks/use-theme.ts), `use-project-todos.ts`, and [`push-reminder.ts`](../src/lib/push-reminder.ts). |
| React state | Navigation, filters, selected project, progress, transient Git responses, notices | Session-local; these are not part of the workspace cache. |
| Service worker cache | Built application shell and static assets | Generated by [`vite.config.ts`](../vite.config.ts); separate from workspace persistence. |

Browser project IDs are `browser:<selected-directory-name>/<relative-path>`.
Helper IDs are the first 20 hexadecimal characters of a SHA-256 hash of the
absolute project directory, generated in [`server/scanner.ts`](../server/scanner.ts).
IDs therefore differ between connection modes; helper IDs also change when a
checkout moves. Browser IDs do not distinguish roots with identical names and
relative layouts. Avoid treating a display name as a durable project identity.

[`workspace.ts`](../src/lib/workspace.ts) preserves data-URL PNG previews and
dated storage, audit, outdated, unused, React Doctor, and Lighthouse reports across scans
when the new scan omits those reports. Cached results describe the time they were
measured, not necessarily the current files. Captured screenshot URLs are fetched
from `/api/screenshots/` and converted to data URLs before persistence so they can
survive a helper restart.

Todo dismissals are scoped by workspace mode/root and todo ID, and record the
individual finding keys and scan timestamp. New findings can reappear; incomplete
React Doctor reports cannot establish that old findings were resolved. Push
reminder dismissals use the workspace root and local calendar day.

[`config-backup.ts`](../src/lib/config-backup.ts) exports preferences, not scan
results, previews, or directory permissions. Imports match compatible project IDs,
normalized remotes plus package paths, and relative paths; ambiguous matches are
reported rather than guessed. Existing favorites and tags are merged. Storage
coordinates the IndexedDB preference write with settings/theme writes and rolls
back localStorage when the transaction fails. A preferences-changed event updates
same-tab settings/theme consumers; storage events handle cross-tab changes.

Editor, Git-client, and script-terminal preferences (`editor`, `gitClient`, and
`terminal`) are validated against the shared allowlist in [`desktop-apps.ts`](../src/lib/desktop-apps.ts). Missing or
invalid stored values fall back to VS Code, Sourcetree, and Automatic; older
configuration backups may omit these fields. Settings → Applications saves the choices through
the existing settings provider, including cross-tab synchronization and backup
export/import. Cards and detail buttons read the same preferences and send an
`OpenProjectRequest` through the existing workspace action hook. Browser/demo
actions retain the helper connection flow. Script actions receive the current
terminal preference in the workspace action hook and send it as the optional
`RunProjectScriptRequest.terminal` field. The catalog labels supported launcher
platforms; it does not detect whether applications are installed.

## Operation and watcher coordination

The `busy` string describes the current workspace operation. Connect, resync,
disconnect, manual actions, batches, and automatic scans check it and active batch
refs before beginning. `workspaceVersion` increments when an operation takes
ownership; async results check their captured version before applying updates.
When adding a workspace-changing flow, preserve these guards and the existing
ref-based active checks, which cover the interval before React rerenders.

The preview, audit, outdated, React Doctor, and Lighthouse batch hooks snapshot their queue
and process one project at a time. Stop requests take effect after the active
request finishes; they do not abort helper work already in progress. Each success
persists the accumulated workspace. A later successful write saves earlier batch
results too, so it clears accumulated cache-write warnings. Individual failures
are recorded while remaining queued projects continue.

All five batch panels share the current-step display in
[`scan-progress-panel.tsx`](../src/components/scan-progress-panel.tsx), including
the active project, helper-reported stage and details, time in that stage, and
total elapsed time. Their progress bars count completed projects; stages do not
imply an estimated percentage. Ordinary explanatory notes use neutral styling,
while partial results, cache problems, and failures retain warning styling.
Timers do not announce every second to assistive technology and the panels use
the existing reduced-motion styles.
The current-step block uses a fixed height with a larger allowance in narrow
containers. Its keyboard-accessible content scrolls independently of the timer
and returns to the top when the phase changes, keeping surrounding content stable.

[`use-scan-progress.ts`](../src/hooks/use-scan-progress.ts) supplies the same live
display for individual scans, automatic checks, connection, and metadata sync.
Active project and connection dialogs also show the relevant progress. Stage
updates use the existing workspace generation and batch guards, and callbacks
from finished projects cannot overwrite a later project's progress. Stages and
their clocks are never saved in IndexedDB. Browser directory scans report their
own read-only discovery stages.

The API adapter requests `application/x-ndjson` when a progress callback is
provided. It incrementally reads progress, final-result, and error frames, keeps
ordinary JSON responses compatible, and treats a stream without a final result
as a failed request. The existing helper re-registration retry also applies to
streamed errors. Saving the browser cache is a separate final client stage.

The watcher supports manual, periodic, and package-change modes. Manual is the
default. Periodic mode rescans the connected workspace; package-change mode polls
the helper's `/package-changes` endpoint and compares fingerprints. Its baseline
and timer survive ordinary metadata updates and reset when workspace identity or
relevant settings change. Busy work causes a short retry; offline state pauses
watching. A second busy check after the change request prevents it from taking
over a newly started manual operation.

An automatic run first rescans metadata, then optionally performs audit, outdated,
storage, React Doctor, and Lighthouse checks. `watcherReactDoctor` and
`watcherLighthouse` default to false, including when older saved settings or
configuration backups omit them. The additional checks reuse `isReactProject`
and `isLighthouseProject` eligibility. Check descriptors distinguish helper action
names from response fields (`react-doctor` returns `reactDoctor`) and supply
progress labels. Missing reports count as failed checks and leave dated results
intact. Browser-directory scans only refresh metadata.

Change-triggered runs select affected and newly discovered projects; periodic
runs select all projects. Change detection expands to siblings that share a
declared package workspace; it does not watch source files. Changing either new
setting invalidates the active watcher generation and resets its schedule, just
like the existing check options. Pending requests can finish, but their stale
results and remaining checks are discarded. Automatic Lighthouse scans use the
helper's normal browser and temporary development-server lifecycle.

[`packageWorkspaceId`](../src/lib/workspace.ts) defines this shared maintenance
scope: declared workspace members use their workspace ID; merely grouped
subprojects use their own ID. Package updates clear affected reports across that
scope before refreshing metadata. Repository-wide Git aggregation uses a
different rule in [`daily-summary.ts`](../src/lib/daily-summary.ts): grouped
projects share their outermost repository history even without a declared package
workspace. Keep these two identities distinct.

The API adapter retries an unknown-project action once after a helper restart by
lazily scanning the cached root. Concurrent registration requests share a promise,
and root changes invalidate the retry. Background `/status` polling deliberately
does not trigger registration or scanning.

## Rendering and offline constraints

The PWA caches application assets, with navigation fallback restricted to the
single root route and explicitly excluding `/api`. Cached browsing and durable
previews can work offline; helper operations still need the running local helper.
No service-worker API-response cache is configured.

[`project-readme.tsx`](../src/components/project-readme.tsx) renders Markdown with
GFM support and raw HTML skipped. Dialogs use shared Radix primitives. `App`
restores focus to project/tag openers, and project tabs implement arrow/Home/End
keyboard navigation. Preserve those behaviors when reorganizing UI flows.

## Vulnerability fixes and suppressions

[`project-audit.tsx`](../src/components/project-audit.tsx) keeps vulnerability
scanning separate from the requested **Install compatible fix** action. Shared
[`audit-fix.ts`](../src/lib/audit-fix.ts) identifies supported declared dependencies
or an audit-reported direct parent; suppressed findings and findings without a
reported fix have no install control. Buttons identify the target package and
are disabled without the helper, in demo mode, while busy, or while the selected
project's development server is starting or running.

The action sends only an `AuditFixRequest` finding identity through the existing
workspace action hook; the helper selects and revalidates the version to install.
Compatible fixes stay within the current major version, pin exact versions, and
disable lifecycle scripts. The normal workspace operation guards, report
invalidation, metadata refresh, and notices apply. A new audit reports remaining
findings after installation; the UI never treats an installation as a clean audit.
Older cached findings can omit fix metadata and remain readable.

Audit `counts` contain active vulnerabilities after helper-side ignore matching.
Cards, severity filters and sorts use those counts. Findings optionally carry
`suppression` provenance; older cached findings without it remain active.
`ProjectAudit` places suppressed findings last with neutral styling and their
source rules, distinguishes an all-suppressed report from a clean report, and
shows alias/rule warnings. Critical alerts and security todos exclude suppressed
findings, including from the previous-alert identity set so removing or expiring
an ignore can produce a new critical alert after a fresh audit. Cached suppression
state is preserved with the successful report and refreshed by auditing, not by
ordinary metadata scans or the passage of time alone.


### Helper workspace reconciliation

`use-helper-state.ts` polls the REST workspace snapshot every three seconds while
visible and helper-connected, and on focus. Local actions pause polling; workspace
generation and revision guards reject late replies. Externally active work feeds
the existing global busy state, deferring watcher and batch starts. The helper's
runtime remains authoritative for races between polls. Reports and explicit
invalidations persist through the existing workspace cache; ordinary missing
fields preserve dated snapshots. Per-report revisions prevent late scans from
restoring invalidated reports. Helper restarts re-register the root and retained
cached reports are labeled as having unknown freshness. Changed preview images
are downloaded into the durable cache. Cache failures retain the existing visible
warning. No MCP access to browser preferences or durable storage is introduced.

Process lifecycle changes (pending start, readiness, stop, failure, and unexpected
exit) advance the helper revision too. The same reconciliation updates project
server buttons and running filters for work started by MCP, including when the
browser previously knew no server was running. Process logs remain on demand.

## Public repository activity

`remoteActivity` is an optional dated report containing a canonical repository URL
and complete open issue / pull request ID lists. Older caches omit it. The project
card shows linked counts (including known zeroes), with the last successful check
in each badge's accessible label and tooltip. A changed Git origin clears the
old report; metadata rescans, helper restarts and failed checks preserve matching
successful reports. Package mutations do not invalidate remote activity.

The project menu and command search offer **Check issues and pull requests** for
supported origins. The workspace toolbar's **Run checks → Check issues & PRs** uses
[`use-remote-activity-batch.ts`](../src/hooks/use-remote-activity-batch.ts), with
sequential requests, stop-after-current, generation guards and cache/failure
reporting. Projects sharing a canonical origin are checked once and receive the
same result. The helper remains required for these actions.

The optional **Public issues and pull requests** watcher setting defaults off.
Periodic mode includes these checks; package-change mode also checks remote
activity at the configured periodic interval (at least five minutes), even with
unchanged local fingerprints. These scans use the existing action hook, global
busy state and helper reconciliation. They run only while the app is open and
online. Manual mode makes no automatic requests.

The first successful result establishes a baseline. Later results compare open
item IDs, so replacing an issue while keeping the same total still produces an
in-app notice. Reopened items count as newly open. Results are compared per
repository, with one notice per checked repository, and saved to the existing
workspace cache. Items opened and closed between checks are not observed.
