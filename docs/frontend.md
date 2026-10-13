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
| Directory connection | [`use-workspace-connection.ts`](../src/hooks/use-workspace-connection.ts) coordinates connection, manual resync, disconnect, and metadata progress with workspace generations and batch guards. |
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

Project card branch tooltips use `ProjectBranch` and the shared `ScanBadgeTooltip`
for hover/focus access, Escape dismissal, theme styling, and scan age. They read
optional `git.recentCommits` from the workspace snapshot, falling back to the
existing latest commit with an unavailable-history note for older/browser data.
Opening a tooltip issues no request.

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

`useWorkspaceProjects` prepares display projects, tag suggestions, favorites and
technology counts from the cached workspace and preferences. `WorkspacePage`
selects the loading/error state, todos, daily summary, or project browser; action
callbacks and workspace ownership remain in `App`.
`WorkspaceStatus` groups helper activity, synchronization errors, cached-report
guidance, and active scan progress above the selected page. It only renders the
state supplied by the existing hooks; it does not own polling or scan lifecycles.

`useWorkspaceConnection` owns the directory-operation workflow and temporary scan
progress. It checks both global busy state and live batch activity before starting,
preserves cached reports on resync, and stops owned workspace servers before
switching directories or disconnecting. `App` retains workspace persistence,
navigation, dialog state, and critical-alert state through callbacks.

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

The todo view delegates project grouping, priority ordering, scan coverage, and
latest valid scan time to `projectTodoOverview` in `src/lib/project-todos.ts`.
Tasks are indexed by project for grouping. Separate task-row and empty-state
components render the results; the parent retains dismissal focus restoration
and routes actions through the existing callbacks.

[`use-todo-filtering.ts`](../src/hooks/use-todo-filtering.ts) owns independent,
temporary search, multi-select filters, and sort state for this view. Pure
[`project-todo-filtering.ts`](../src/lib/project-todo-filtering.ts) matches search
words across task text and project metadata, combines project/type/priority
facets, and counts alternatives while ignoring each facet's own selection.
Sorting preserves project groups; date sorts use matching task scan times,
placing invalid dates last. The unfiltered, project-scoped overview remains the
source for totals and scan coverage; filtered results have a separate count and
no-match recovery. Controls survive report changes and dismissals, reset when
the page unmounts, and remount with workspace mode/root changes.
[`todo-filters.tsx`](../src/components/todo-filters.tsx) and the main list reuse
the checkbox menus and removable chips in
[`list-filters.tsx`](../src/components/list-filters.tsx), the existing search and
filter styles, and [`sort-control.tsx`](../src/components/sort-control.tsx).

The topbar composes separate breadcrumb and connection-status displays alongside
its actions. The connection dialog owns hosted/browser mode selection and
composes a helper form only in local mode; all connection callbacks and state
remain owned by `App`.
Sidebar navigation shares a button component for active-page semantics and
styling while keeping navigation callbacks and count badges in the parent.
Project cards delegate disk usage to a storage-summary component, including the
measurement timestamp and lower-bound indicators for partial reports.
The settings dialog owns its draft, validation, tab selection, and persistence.
Its Interface tab and footer render through separate components; Interface edits
still change only the draft until save, and backup transfers retain their close
guard.

[`workspace-toolbar.tsx`](../src/components/workspace-toolbar.tsx) keeps directory
identity and workspace actions together. **Run checks** opens the existing Radix
menu for public repository activity, outdated packages, vulnerabilities, React
Doctor, and Lighthouse; preview capture remains a direct action. The menu explains
that checks include projects hidden by filters and preserves eligibility, helper
connection, and global busy guards. Selections use the same action callbacks and
batch progress panels as before. Keyboard dismissal restores focus to the trigger,
or to the labeled action group while a check has disabled the trigger.
Check descriptors are built separately from menu rendering and use one active
project list for React, Lighthouse, and public repository eligibility. Ignored
projects cannot keep an otherwise unavailable check enabled.

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

**Save filter** opens [`save-filter-dialog.tsx`](../src/components/save-filter-dialog.tsx)
to name a snapshot of filters, query, search scope, and sort order. The filtering
hook saves it through the settings provider and applies sidebar shortcuts by
replacing those values together, returning to projects, and resetting command
search selection. Saved entries use stable UUIDs and appear in array order directly
after Todos in the workspace navigation, with filter icons and no separate heading.
The active shortcut and breadcrumb name apply only while the live
criteria match the selected snapshot; editing live criteria leaves the saved
entry intact. Removing a shortcut leaves the current live criteria in place.
Settings → Custom filters edits names, ordering, and removal in the existing
settings draft, with labeled name fields, validation, keyboard-accessible buttons,
and focus restoration after list changes. Renaming preserves the entry ID and
criteria; saving updates the sidebar and active breadcrumb together.

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
The search component owns selection, keyboard handling, placement, and action
availability. Separate popover and scope components render those values and
delegate interactions back to that owner, preserving focus and listbox IDs.

Selections delegate to `App` callbacks and the existing workspace action hook,
tag editor, settings trigger, and filter state. `App` resolves the selected
command against current project metadata before dispatch. Helper operations
retain connection, busy, batch, version, and watcher coordination; the helper
continues validating the script name and displayed command against the current
manifest. Cleanup and package mutation suggestions open existing review controls
and retain their confirmation behavior. No new API or durable search state is
introduced. Project and tag dialogs restore focus to the search opener.

## Cached commit activity

[`use-commit-activity.ts`](../src/hooks/use-commit-activity.ts) retains only successful,
first-page, all-branch history activity supplied by `ProjectHistory` whose author
filter matches the optional `commitActivityAuthor` setting. Successful
helper connection, manual sync, and watcher sync also supply an explicit refresh
snapshot through `persist`. The hook reads history for deduplicated Git repositories
with at most three requests in flight, preserving prior reports on failure. It
reuses an ID index for project and monorepo-parent lookups and a set of ignored
IDs, updated after committed workspace changes. Queued reads consult that latest
set so ignoring a project takes effect without restarting an active refresh. It
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

The same hook exposes a workspace- and author-scoped `projectActivity` map for
preview overlays. `previewCommitActivity` derives 90 UTC daily buckets, keeping
uncovered dates distinct from known zero counts, and monorepo members reuse their
repository's derived activity. `App` passes these snapshots through project results
and the detail dialog to `ProjectPreview`; the small SVG in
[`project-commit-activity.tsx`](../src/components/project-commit-activity.tsx) overlays
screenshots, preview assets, and empty-preview placeholders with no background.
Thin, square-topped bars use the card's `--surface` color at full opacity and sit
flush with the preview's bottom edge, creating a skyline that merges into the
card. Open SVG paths draw a contrasting `--foreground` border on the left, top,
and right edges, with no bottom stroke or shadow. `non-scaling-stroke` keeps the
border one CSS pixel wide in grid, list, and detail views. A half-pixel horizontal
inset and visible SVG overflow keep the outer strokes intact within the preview.
The graph is 27px high in grid and detail views, and 15px high in list view.
Bars scale to the maximum count within that project's window. Zero-count days
render no marks but retain their horizontal slots; missing coverage still uses
hollow marks. Tooltips and an
accessible description identify dates, author selection, cache age, and shallow or
missing coverage. Missing caches render no chart. Rendering does not request Git
history or add persistence, and the existing refresh and stale-response guards
apply to both the header and preview graphs.

## Project details and action menus

Projects with worktree relationships display branch/path context, and list view
groups their matching rows by repository and checkout. Grid cards remain separate.
Filtering happens before grouping, preserving project counts and selected sort
order; hidden siblings are never inserted. The Worktree facet is independent of
the existing Branch and Project structure facets. Saved filters retain it.

The cached **Worktrees** tab shows scope, scan age, main/linked roles, working
changes, and unavailable/external entries. **View package** navigates to the same
checkout-relative package path; **View checkout** explicitly falls back to the
root when that package is absent. It opens Overview in the existing dialog without
running Git or changing filters. Closing restores the original opener; removed
projects show an unavailable panel. Log responses carry their project ID so late
responses cannot populate a different selected checkout. Browser pointer files
show unresolved relationship guidance rather than inferred linked status.

Daily summaries and commit heatmaps use aggregate repository reads scoped to
active projects and the current helper root. Activity caches use shared repository
IDs for verified Git contexts; single-checkout History callbacks cannot overwrite
aggregate activity. Cached aggregates record their eligible checkout membership;
changes immediately hide incompatible counts and refresh them, including when a
checkout is ignored. Ignoring one package does not change coverage when another
eligible project still represents that checkout. Push reminders show a shared
unpushed count plus named dirty or unavailable checkouts. Favorites, tags,
ignored state, maintenance reports,
previews, and dev processes remain project-specific.

The project dialog keeps the preview, metadata, and latest commit in **Overview**,
followed by documentation, disk usage, and dependency cleanup. **History** contains the commit
log, and **Development** holds the server, scripts, preview capture, and logs.
**Packages** lists declared dependencies; **Vulnerabilities**, **Updates**, and
**Metrics** contain the audit, outdated-package and minor/patch update controls,
and Knip reports. Metrics also renders the optional `codeMetrics` snapshot with
a total and accessible, labeled CSS bar charts in `project-code-metrics.tsx`.
Missing snapshots prompt resync; partial counts retain their warnings. The tab
also shows file counts and average, minimum, maximum, and median lines per file.
A local file-type selector scopes those statistics to all types or one type;
it also scopes the file-size histogram in `code-distribution-chart.tsx`. The SVG
uses line ranges on the x axis and file counts on the y axis, with visible counts,
an accessible description, and an expandable data table. Distributions contain
up to 100 bars; dense charts use sparse boundary labels and one-pixel bar gaps,
with exact counts in hover titles and the table instead of overlapping bar labels. Its scroll region is
keyboard accessible on narrow screens. Missing distributions prompt resync;
empty and partial distributions are labeled explicitly. Both axes adapt to the
selected type. The existing project total and composition chart keep their overall
scope. Missing cached statistics prompt resync, while empty scans display dashes. The selector falls
back to all types if its chosen type disappears during a rescan. The tab
also shows **Largest files** below the histogram: at most ten files of 500 or more
nonblank lines, with project-relative paths, types, and counts. The selector uses
each type's separately collected top ten, rather than filtering the overall list.
Old caches prompt resync; empty and partial lists have distinct explanations. The tab
keeps its internal `unused` key so existing action navigation remains valid.
Eligible projects also show **React Doctor** and **Lighthouse**. `ProjectHistory` mounts only when **History** is
selected, so opening the overview does not load its commit log.

[`project-documentation.tsx`](../src/components/project-documentation.tsx) shows
the first parsed README heading and prose paragraph with a keyboard-accessible
disclosure. A Radix menu lists cached Markdown documents in their directory
hierarchy, with README first; choosing a document opens its full content.
Selection and expansion are local to the current project view. Markdown rendering
retains GFM and safe links, skips raw HTML, and never executes MDX components.
The README command opens Overview. Older caches without `documentation` still
show their README; resync discovers docs without a storage migration.

The shared Markdown viewer turns `mermaid` fences into
[`mermaid-diagram.tsx`](../src/components/mermaid-diagram.tsx). Mermaid is imported
only when a visible diagram needs rendering, so collapsed introductions do not
load it. [`use-mermaid.ts`](../src/hooks/use-mermaid.ts) follows the resolved DOM
theme, discards stale results, and releases image URLs on changes or unmount.
[`mermaid.ts`](../src/lib/mermaid.ts) serializes initialization/rendering around
Mermaid's global configuration, applies locked strict security settings and
50,000-character/500-edge limits, and removes its temporary render container.
Rendered SVGs are displayed as static blob images, with an accessible title and
source disclosure; failed diagrams retain readable source. No remote rendering,
new helper endpoint, or workspace-cache schema is involved. The production PWA
precaches the bundled diagram chunks for offline use.

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

Project action menus expose the Development tab’s additional scripts through a
**Scripts** submenu, reusing script discovery and excluding the primary server
script. Selections send the displayed name and command through the existing
workspace action hook, preserving terminal preferences, helper connection flow,
and busy guards.

Scan and public activity badges share `ScanBadgeTooltip`, built on Radix Tooltip
with portal positioning, keyboard focus, Escape dismissal, and hoverable content.
Theme tokens and reduced-motion styles cover the tooltip surface. Report ages
use `scanRelativeTime`, refresh on opening and every 30 seconds while open, and
keep invalid or future dates explicit. Accessible badge names and click actions
remain on the original buttons and links.

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
| React state | Navigation, live filters, selected project, progress, transient Git responses, notices | Session-local; these are not part of the workspace cache. Saved custom filters live in settings. |
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
Configuration downloads release their temporary object URL after a short delay,
including when link setup or download initiation fails.

The `customFilters` settings array contains named filter snapshots, shared across
workspaces and included in configuration backups. [`project-filter-state.ts`](../src/lib/project-filter-state.ts)
defines the state types and validates stored entries independently of project
metadata. Missing older settings default to an empty array. Corrupt entries and
duplicate IDs are discarded on browser preference reads; imports reject them.
Invalid criteria discard the entire entry rather than broadening its match.
Dynamic values absent from the current workspace remain selected through the
existing filter-group builder. Settings import replaces this array; resetting
defaults clears it. No helper API or IndexedDB migration is involved.

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

The workspace renders its batch panels through `WorkspaceBatchProgress`, keeping
the batch hooks and their stop/dismiss actions in the operation coordinator.
`projectScanProgress` selects individual or matching batch progress for project
details without fabricating missing stage timestamps.

All batch panels share the current-step display in
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
Active project and connection dialogs also show the relevant progress. The page-level
panel keeps a 20px gap before the workspace controls or other content. Stage
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

[`use-workspace-favicon.ts`](../src/hooks/use-workspace-favicon.ts) observes the
connected workspace's active projects before search/view filtering. Existing
reports seed a session-local baseline on cache restoration or workspace changes.
[`workspace-updates.ts`](../src/lib/workspace-updates.ts) compares fresh successful
reports by finding identity: vulnerabilities and severity escalations, newly open
remote items after their first baseline, high-priority dependency updates, and
React Doctor errors. Shared package audits and repository activity are deduplicated
using their respective maintenance and remote identities. Missing, invalidated,
older, or unknown-freshness reports cannot establish resolution. Skipped dependency
entries and incomplete React Doctor scans retain prior comparison findings.

Updates accumulate while the document is hidden or unfocused. A visible, focused
tab acknowledges them; this does not dismiss critical dialogs or todo findings.
Workspace changes, disconnect, and unmount clear the indicator. There is no new
persistence, timer, network request, or helper action.
[`favicon.ts`](../src/lib/favicon.ts) overlays a static red exclamation, amber dot,
or blue dot on the existing SVG brand source and adds an unread summary to the
document title. It updates the tab icon links together and restores their original
attributes and title on acknowledgement/cleanup. Touch and PWA icons are unaffected.

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

Polling options and the workspace snapshot used to protect report revisions are
published to refs in layout effects, so unfinished renders cannot change the
state seen by asynchronous work. Persistence also advances its workspace ref
immediately to protect consecutive writes before React commits the next render.

Process lifecycle changes (pending start, readiness, stop, failure, and unexpected
exit) advance the helper revision too. The same reconciliation updates project
server buttons and running filters for work started by MCP, including when the
browser previously knew no server was running. Process logs remain on demand.

## Public repository activity

`remoteActivity` is an optional dated report containing a canonical repository URL
and complete open issue / pull request ID lists. Older caches omit it. The project
card shows linked counts (including known zeroes), with the last successful check
in each badge's accessible label and a relative age in its tooltip. A changed Git origin clears the
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

## Ignored projects

Choose **Ignore project** in a project's action menu to move it to the compact
**Ignored projects** list below the active results. A subtle dashed divider
separates this section; grid view uses compact bordered cards aligned with the
responsive project columns. Its menu offers **Unignore
project**. The choice is saved in the browser workspace cache and survives
rescans and reloads; reports, favorites, and tags are retained.

Ignored projects are excluded from global checks and preview batches, automatic
checks, package-change triggers, push reminders, and daily summaries. Directory
discovery still refreshes metadata so projects remain available to unignore.
Ignoring an individual package does not ignore its siblings or prevent a shared
workspace check from inspecting shared dependencies. It does not stop running
servers or change the independently configured MCP service.

The optional `Workspace.ignoredProjectIds` uses durable project IDs; older caches
default to no exclusions. `activeProjects()` selects batch and background check
queues without removing entries from the persisted workspace. Ignore changes
respect the busy guard and advance the workspace generation to reject in-flight
helper reconciliation responses.
