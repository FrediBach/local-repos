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
| Project browsing | [`use-project-filtering.ts`](../src/hooks/use-project-filtering.ts) owns filters, search, sorting, and the current page. [`project-results.tsx`](../src/components/project-results.tsx) renders grouped results and [`project-card.tsx`](../src/components/project-card.tsx) renders each project. |
| Project details | [`project-detail-dialog.tsx`](../src/components/project-detail-dialog.tsx) composes overview, packages, React Doctor, and README tabs; controls delegate actions back to `App`. |
| Workspace operations | [`use-workspace-actions.ts`](../src/hooks/use-workspace-actions.ts) handles helper actions, maintenance batches, automatic scans, result merging, and notices. |
| Automatic work | [`use-workspace-watcher.ts`](../src/hooks/use-workspace-watcher.ts) schedules scans; [`use-push-reminder.ts`](../src/hooks/use-push-reminder.ts) schedules Git push-status checks. |
| Summary and todos | [`use-daily-summary.ts`](../src/hooks/use-daily-summary.ts) loads Git activity; [`use-project-todos.ts`](../src/hooks/use-project-todos.ts) derives actionable findings and reconciles dismissals. |
| Data access | [`api.ts`](../src/lib/api.ts) calls the helper; [`filesystem.ts`](../src/lib/filesystem.ts) scans browser directory handles; [`storage.ts`](../src/lib/storage.ts) owns IndexedDB access. |
| Domain logic | [`src/lib`](../src/lib) contains parsing, monorepo matching, grouping, filtering, scoring, tag normalization, configuration matching, and report formatting. Keep reusable transformations here rather than inside rendering code. |
| UI primitives and styles | [`components/ui`](../src/components/ui) wraps buttons and Radix dialogs/menus. Global layout lives in `index.css`, feature styles beside their components, and color variables in [`theme.css`](../src/theme.css). |

## Runtime modes

| Mode | Data source | Capabilities |
| --- | --- | --- |
| Demo | [`demo.ts`](../src/lib/demo.ts), used while `workspace` is undefined | Sample projects and browsing; helper actions prompt the connection flow. |
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

On startup, `App` restores the workspace and favorites together and loads tags
separately from IndexedDB. It registers the cached helper root with `api.ts`
without immediately rescanning it. Version refs prevent an older cache load from
replacing a newer connection or favorite edit. Readiness flags keep configuration
imports and tag editing from racing initial preference restoration.

The rendering pipeline is:

1. Take scanned projects from the workspace, or use the demo projects.
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

## Persistence and identity

| Storage | Contents | Identity |
| --- | --- | --- |
| IndexedDB database `local-repos`, store `preferences`, version 1 | `workspace`, `favorites`, `project-tags` | One workspace snapshot; favorite IDs and tag maps persist independently of disconnection. Browser snapshots include the directory handle. |
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
dated storage, audit, outdated, unused, and React Doctor reports across scans
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

The preview, audit, outdated, and React Doctor batch hooks snapshot their queue
and process one project at a time. Stop requests take effect after the active
request finishes; they do not abort helper work already in progress. Each success
persists the accumulated workspace. A later successful write saves earlier batch
results too, so it clears accumulated cache-write warnings. Individual failures
are recorded while remaining queued projects continue.

The watcher supports manual, periodic, and package-change modes. Manual is the
default. Periodic mode rescans the connected workspace; package-change mode polls
the helper's `/package-changes` endpoint and compares fingerprints. Its baseline
and timer survive ordinary metadata updates and reset when workspace identity or
relevant settings change. Busy work causes a short retry; offline state pauses
watching. A second busy check after the change request prevents it from taking
over a newly started manual operation.

An automatic run first rescans metadata, then optionally performs audit, outdated,
and storage checks. Change-triggered runs select affected and newly discovered
projects; periodic runs select all projects. Change detection expands to siblings
that share a declared package workspace.

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
