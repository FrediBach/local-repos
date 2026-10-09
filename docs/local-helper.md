# Local helper architecture

The helper gives the browser access to local repositories, Git, package managers,
development processes, and preview capture. It is a separate Express process,
not part of the static frontend build. Shared response models live in
[`src/types.ts`](../src/types.ts). The scan exposes its root path and relative
project paths; authoritative action directories and process handles stay in
server-side `RegisteredProject` and `ProjectRuntime` state.

## Entry points and request flow

[`scripts/dev.mjs`](../scripts/dev.mjs) starts Vite and the helper together and
stops both when either exits. [`server/index.ts`](../server/index.ts) listens on
`127.0.0.1:4318`, handles startup errors, and calls `runtime.shutdown()` on SIGINT
or SIGTERM. `npm run helper` starts only this process.

[`createApp()`](../server/app.ts) creates a fresh Express app, project registry,
runtime, and workspace map. Returning these objects separately allows tests to
exercise HTTP behavior without the production listener. The Vite development
and preview servers proxy `/api` to the helper; their ports are 5180 and 4173
respectively ([configuration](../vite.config.ts)).

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
| Dependency changes | `POST /update-packages`, `/delete-node-modules` | Runtime and maintenance services |
| Storage | `POST /storage` | Runtime and storage service |
| Preview | `POST /screenshot`, `GET /api/screenshots/:filename` | Runtime and preview services |
| Desktop integration | `POST /open`, `/run-script` | Runtime and script service |

`HelperError` carries an HTTP status and a user-facing message. Unknown errors
are logged by the helper and returned as a generic 500 response. Invalid JSON
gets a 400 response; JSON bodies are limited to 16 KB. Keep response types in
[`src/types.ts`](../src/types.ts) aligned with service and client changes.

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
for a fixed list of manifests, lockfiles, and package configuration files. It
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
  honors explicit script configuration and supplies loopback host/port defaults
  where supported. Runtime launches the package manager with argument arrays and
  `shell: false`, checks configured/logged loopback URLs for up to 45 seconds, and
  keeps the last 40,000 log characters. Stop invalidates pending starts, sends
  SIGTERM, then SIGKILL after two seconds. Generation counters prevent stale
  starts from overwriting a newer stop/start. Local starts are unsupported on Windows.
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
- **Package updates:** [`package-update.ts`](../server/package-update.ts) resolves
  eligible stable registry versions before installing minor or patch updates.
  It skips peer dependencies, ambiguous declarations, and unsupported ranges,
  rechecks the original manifest before mutation, and disables lifecycle scripts.
  Installs may partially succeed; related projects' package/storage reports are
  invalidated and dependency metadata refreshed even if an install fails.
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
  `package.json`, then launches the package-manager script in a system terminal.
  Paths and names are quoted; browser-supplied script bodies are never interpolated.
  Terminal scripts run independently and are not tracked as runtime dev servers.

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
