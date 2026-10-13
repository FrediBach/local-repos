# Git worktree support plan

Status: first release implemented, 2026-10-13. Phases 0–4 cover existing
worktrees; phase 5 remains planned. This document preserves the design
proposal. See the [user guide](../../README.md#git-worktrees) and architecture
guides for implemented behavior and limitations.

Implementation verification on 2026-10-13:

- `npm test`: 144 test files and 1,618 tests passed; no skipped tests reported.
- `npm run build`: passed, including typechecking. Vite retains its large-chunk
  advisory warning.
- Isolated Chromium against disposable Git fixtures verified hidden-worktree
  discovery, sibling package navigation, list/grid views, mobile and dark layouts,
  and Escape closing. No page errors or horizontal page overflow were observed.
  UI tests cover action targeting, focus restoration, stale logs, and unavailable
  states. The native in-app browser bridge was unavailable for this session.
- `git diff --check` and local documentation-link checks passed.
- `npm run doctor` still exits nonzero with 34 findings. The newly introduced
  unstable default props were fixed. The watcher-cleanup error is a false
  positive: cleanup clears its timer and invalidates late work, with cancellation
  tests passing. Remaining findings include existing advisories, intentionally
  bounded asynchronous loops, and component-complexity warnings.

Worktree creation/removal and automatic topology-only watching remain outside
this release. Startup readiness is ordered across sibling checkouts to detect
fixed-port collisions; their running processes and package operations remain
independent. Repository caches include filesystem identity and eligible checkout
membership so replacement or ignore changes cannot reuse incompatible counts.

Support Git worktrees as separate local checkouts of a shared repository. Users
should be able to recognize the checkout they are looking at, find its siblings,
and run existing project actions with confidence about which files they affect.
Repository history should be counted once; checkout state, dependencies, reports,
and running applications must remain separate.

The recommended first release supports **existing worktrees**: discovery,
repository relationships, navigation, accurate summaries, and existing actions.
Creation and removal follow as a separate milestone after these foundations are
verified. The application continues to display one connected folder at a time.

## Product decisions

| Decision | Proposed behavior |
| --- | --- |
| Unit of work | Keep each checkout and its detected packages as separate projects with their existing IDs. |
| Repository relationship | Add a shared Git repository identity independently of monorepo/package workspace membership. |
| Library views | Group related checkouts in list view; retain individual cards in grid view. |
| Navigation | **View worktree** opens another project's details. It never checks out a branch or redirects future actions through a global active-worktree setting. |
| Discovery scope | Automatically include verified worktrees inside the connected folder. Show outside-folder references as informational entries only. |
| Preferences | Favorites, tags, ignored state, and todo dismissals remain attached to individual projects. |
| Maintenance | Installs, cleanup, invalidation, previews, and development processes stay within the selected checkout's package scope. |
| Git aggregation | Deduplicate shared history while inspecting working changes in each eligible checkout. |
| Browser access | Preserve read-only discovery and explain unavailable Git relationships without following Git pointer files. |
| Initial scope | No worktree creation, deletion, movement, repair, branch checkout, fetch, or push in the first release. |

## Pre-implementation baseline and gaps

The helper already detects a project when an entry named `.git` exists, including
a file, and invokes Git from that project's directory. Consequently, a linked
worktree encountered by the normal traversal can already receive branch, commit,
and dirty-state metadata. The missing feature is a reliable relationship model
and the behavior built on it, rather than basic Git invocation.

| Existing source | Current behavior and required extension |
| --- | --- |
| [Helper scanner](../../server/scanner.ts) and [scanner tests](../../server/scanner.test.ts) | Bounded traversal skips hidden directories and normally stops at two levels outside projects. It does not enumerate worktrees. Add verified inventory and bounded discovery from known repositories. |
| [Browser scanner](../../src/lib/filesystem.ts) | `.git` files produce an unavailable-metadata warning. Distinguish an unresolved Git pointer from a confirmed linked worktree; a file alone does not establish that relationship. |
| [Shared types](../../src/types.ts) | Git metadata describes one checkout. Add optional repository and worktree contracts that older snapshots can omit. |
| [Project groups](../../src/lib/project-groups.ts), [results](../../src/components/project-results.tsx), [cards](../../src/components/project-card.tsx) | List view groups monorepos; grid view is flat. Add worktree context without changing project identity or implying shared package maintenance. |
| [Details](../../src/components/project-detail-dialog.tsx), [tabs](../../src/components/project-tabs.tsx), [command search](../../src/components/project-command-search.tsx) | Add sibling navigation and disambiguate identical names in action targets. |
| [Daily summary](../../src/lib/daily-summary.ts), [commit activity](../../src/lib/commit-activity.ts), [push reminder hook](../../src/hooks/use-push-reminder.ts) | Current repository selection follows monorepo roots. Separate shared history selection from per-checkout status enumeration. |
| [Workspace logic](../../src/lib/workspace.ts), [runtime](../../server/runtime.ts) | Package scope already has explicit semantics. Preserve these; do not make sibling worktrees `related()` package projects. |
| [Application](../../server/application.ts), [project index](../../server/project-index.ts), [MCP Git reads](../../server/mcp/git.ts) | Preserve current root membership, revision synchronization, authorization, and cursor validity when adding relationships. |
| [Configuration backup](../../src/lib/config-backup.ts) | Remote-plus-package matches can become ambiguous across worktrees. Keep exact matches and report ambiguity instead of choosing a sibling. |

The internal `RegisteredProject.gitDirectory` currently means the directory from
which Git commands run, usually the checkout root. It is **not** `.git` or the
shared Git administrative directory. Keep that distinction explicit in new code.

## Identity and terminology

Use **repository** for shared Git history, **worktree** for a checkout directory,
and **project** for a detected checkout or package entry. The connected Local
Repos **folder** remains the discovery boundary. In UI explanations, use
“package workspace” only when describing shared package maintenance.

Git worktrees share repository data but retain checkout-specific state such as
HEAD and the index. The main worktree is not necessarily on the default branch.
Git's worktree inventory includes branch or detached state and optional locked,
prunable, and bare records. Use `git worktree list --porcelain -z` for parsing
paths that may contain whitespace or newlines. See the
[Git worktree reference](https://git-scm.com/docs/git-worktree).

Resolve the checkout root, private Git directory, and common Git directory
through Git, using `rev-parse` path options and canonical filesystem validation.
Do not infer repository identity from a remote URL, branch name, package name,
or folder basename. Two independent clones of the same remote remain separate
repositories. See the [Git path query reference](https://git-scm.com/docs/git-rev-parse).

```text
Connected folder
  Repository: atlas                     shared history identity
    Worktree: atlas / main              checkout identity
      Project: repository root          existing project ID
      Project: packages/web             existing project ID
      Project: packages/api             existing project ID
    Worktree: atlas-search / feat/search separate checkout identity
      Project: repository root          existing project ID
      Project: packages/web             existing project ID
```

Preserve helper project IDs derived from canonical project paths, including IDs
for worktrees already discovered today. Add a repository ID derived from the
canonical common Git directory plus its filesystem device/inode identity, and a
worktree ID derived from the canonical checkout root, with separate namespaces.
Replacing Git data at the same path therefore changes the history-cache identity
while preserving project preferences and checkout identity. These are local identities, not portable
IDs or authorization tokens. A move still changes path-based identities; automatic
preference migration across moves is outside the first release.

A package inherits its containing checkout's repository/worktree references,
but retains its own project ID and package workspace relationship. A nested Git
repository or submodule has its own Git identity. A `.git` file alone is not proof
of a linked worktree; Git also uses pointer files in other layouts. See the
[repository layout reference](https://git-scm.com/docs/gitrepository-layout).

## User experience

### Library presentation

Keep familiar project names. Add a compact checkout context line where a verified
worktree relationship exists: branch or detached commit, checkout folder, and
**Main worktree** or **Linked worktree** when useful. Keep the relative path
visible so identical package names are distinguishable. Reuse the existing branch
tooltip for recent commits; worktree navigation is a separate control.

In **list view**, repositories with multiple known worktrees get one shared
repository header, followed by checkout headers and their project rows. Reuse
the existing package grouping presentation within each checkout without adding
another deeply indented level. Repositories without a known sibling keep their
current layout. A filtered single match retains enough repository/checkout context
to identify it, without inserting filtered-out projects.

```text
atlas                              4 matching projects in 2 worktrees
  main · Main worktree · Changes   atlas                 [Worktrees 3]
    atlas                          Stopped
    packages/web                   Running :5181
  feat/search · Linked · Clean     atlas-search
    atlas                          Stopped
    packages/web                   Stopped
```

In **grid view**, keep the flat card layout and existing package title treatment.
Add the same checkout context and a quiet **Worktrees 3** button. Do not collapse
multiple checkouts into one card whose actions depend on a hidden selection.
The button opens the selected project's Worktrees tab. For a lone linked checkout,
show the relationship control even when siblings are outside the connected folder.
Place context under the title rather than adding to the crowded mobile footer.
Partial inventories use **Worktrees 3+**, with an accessible explanation, everywhere
the count appears. Dirty state describes the checkout; running state can vary
between its package projects.

Repository headers do not have a Start, Update, Cleanup, Favorite, or Ignore
action in the first release. Each operation must have an explicit project or
checkout target. Keep existing library and sidebar counts as **projects**;
worktree counts are additional context, never a replacement denominator.
Do not invent combined maintenance scores or sum repository-family storage:
existing measurements describe selected paths and may overlap, while shared Git
objects may live in a main checkout or outside the connected folder entirely.

### Worktrees tab

Add **Worktrees** beside History in the existing detail dialog when helper data
confirms a worktree relationship or reports an inventory problem. This avoids a
second management window and keeps the repository context close to Git history.
Ordinary single-checkout repositories need no extra tab initially.

The tab opens immediately from the cached inventory and shows its scan time.
It contains:

- A repository label and scope summary, for example **2 worktrees in this folder,
  1 outside it**. Bare records are labeled separately and excluded from checkout
  totals. Partial inventories use **At least N worktrees**, not a complete count.
- Rows with branch or detached short hash, checkout location, main/linked role,
  availability, and known dirty state. Use **Selected** for the checkout supplying
  the current dialog; avoid “active,” which could imply Git or process state.
- Running project count and expandable project names where a checkout contains
  several applications. Do not equate one running package with a running repository.
- **View worktree** for registered, available checkouts. Existing editor, file
  browser, and terminal actions remain explicitly scoped to a registered project.
- **Sync folder** using the existing resync workflow and global guards. Merely
  opening the tab must not trigger a scan or command.

Order the selected checkout first, then the main checkout if different, then
remaining available checkouts by path, followed by informational/problem rows.
Use text badges for locked and unavailable states, with bounded reason text.
Locked does not mean read-only: it should not disable ordinary project actions.

### Moving between checkouts

**View worktree** changes the selected project in the same dialog. When invoked
from a package, a sibling containing the same checkout-relative package path
offers **View package**, displaying that path before selection. Match by path,
not package name. Otherwise offer **View checkout** with the explanation
**packages/web is not present here** and target the checkout root explicitly.

Open the destination's Overview and announce the new project and checkout, with
focus on its heading or selected tab. Reset checkout-specific logs, history
pagination, script selection, and pending request state. Advance request guards
so late responses from the previous project cannot populate the destination.
Browsing another checkout does not stop or start processes. Closing the dialog
returns focus to its original opener, or a stable library control if that opener
has disappeared.

### Search, filters, and sorting

Preserve existing branch/path search and add repository labels and missing
checkout context to general search and command suggestions. Preserve package-only
search semantics. Suggestions and
action labels must include checkout context, for example
**Run dev · atlas / feat/search / packages/web**. Detached HEAD uses a short hash;
unknown branch metadata must never be labeled `main` or clean.
Apply the same context to ignored-project rows, todos, critical alerts, batch
progress, errors, and script confirmations. Global checks still include active
projects hidden by library filters; visual grouping does not change batch scope.

Add a Worktree filter with **Main**, **Linked**, and **Unknown** values. Ordinary
verified Git checkouts count as Main; non-Git projects do not match these values.
Git pointers and detected-but-unresolved Git relationships match Unknown. Old
snapshots without any Git detection evidence cannot be classified and do not
match this facet until rescan; do not guess whether they are non-Git. Support these
values in saved custom-filter validation, settings, and backup round trips, with
omitted criteria preserving existing behavior. Keep the existing Branch facet
and retention of selected values absent from the current inventory.

Apply filters before grouping. Never pull an unmatched parent or sibling into the
results. Position each repository group at its first matching project in the
selected sort, and each checkout subsection at its first matching child. Keep
rows in that order; do not pin the main checkout above a more relevant match.
There is no project-results pagination today, so no new pagination system is
needed. Preserve the existing command suggestion and history pagination.

Favorites, Running, tags, ignored projects, and todo filters keep their current
project semantics. Ignoring one checkout root does not implicitly ignore its
packages or siblings. Ignored projects remain excluded from browser-triggered
checks; the Worktrees tab may identify their checkout but must label ignored
entries and never unignore them through navigation. Group result counts describe
matching active projects; the Worktrees tab explains full inventory scope.

### Availability and recovery

| State | UI and action behavior |
| --- | --- |
| Outside connected folder | **Outside this folder**; path reported by Git is informational and not verified by scanning. Offer **Connect another folder** through the existing connection dialog, explaining that this replaces the displayed folder and follows existing process-stop behavior. No direct launch or filesystem action. |
| In scope but not inspected due to limits | **Not scanned · folder limit reached**; no operational project ID. Explain the limit and suggest connecting a narrower folder. |
| Missing, inaccessible, or stale registration | Explain the specific known condition and last observation time. Do not show Clean or enable project actions. Suggest syncing after reconnecting a disk or fixing the checkout externally. |
| Prunable | **Stale Git registration** with a short explanation. No automatic prune or generic Delete button. |
| Inventory query failed | Retain a clearly dated last successful inventory with **Could not refresh worktrees**. Unknown is different from “no other worktrees.” |
| Helper disconnected | Cached browsing remains available; actions use the established reconnect path. Mark live state unavailable. |
| Browser pointer file | **Git relationship unavailable in browser mode** and existing local-helper guidance. Do not classify every `.git` file as a linked worktree. |
| Worktree removed while selected | Show an unavailable panel with **Back to projects** and **Sync folder**. Do not silently select another checkout or move focus mid-action. |

If no known repository was encountered within traversal limits, the helper cannot
enumerate its worktrees. Explain that users can connect directly to a checkout or
to a folder where its repository is discoverable; do not promise whole-disk search.

### Accessibility and visual validation

Reuse Radix dialogs/menus, the existing tab keyboard pattern, feature styles, and
theme tokens. Worktree controls need accessible names containing repository,
branch, and path. Keep interactive controls outside other interactive card targets.
Long paths must wrap in details and remain accessible in card tooltips on focus.
Use textual status labels, visible focus, and reduced-motion behavior. At narrow
widths, inventory rows stack with the primary action after the identifying text.

Review representative layouts in light and dark themes, at desktop width and
approximately 375px, with keyboard-only navigation and 200% zoom. Include a
single repository, several similarly named checkouts, a monorepo, long branch
names, detached HEAD, unavailable rows, and a filtered single result. The first
release should not require learning a separate worktree management screen.

## Shared data contract

Add an optional, normalized repository inventory to `ScanResult`/`Workspace`
and lightweight references on projects. Avoid copying every sibling record onto
every package. The following is the proposed contract shape, with final naming
to be settled alongside implementation:

| Field or record | Purpose |
| --- | --- |
| `RepoProject.gitContext` | Optional discriminated state: Git detected but unresolved, or verified repository ID, worktree ID, and project path relative to the checkout. Separate from successful branch metadata so browser pointers and failed reads remain representable. |
| Repository inventory | Repository ID, display label, last successful observation time, current attempt status, coverage, and bounded worktree records. |
| Worktree record | Worktree ID when verified, role, branch ref or detached/unborn state, HEAD object ID when available, relative display path, optional registered root project ID, availability, and lock/prunable metadata. |
| Coverage | Complete, partial, or unavailable, with bounded warnings and counts of uninspected records. No zero-count success on command failure. |
| Helper-only identity | Canonical checkout path, private Git directory, common Git directory, and identity observation used for revalidation. Never accept these as client-supplied authority. |

External or unavailable records can have a scoped inventory row key for rendering;
that key is not a registered project ID. An outside path reported by Git may be
shown in the local REST UI, but common/private administrative paths stay internal.
Do not persist those administrative paths in preferences, configuration exports,
or public metadata. Treat all names, paths, and reason strings as untrusted text.

Older snapshots can omit every new field. Normalize absent inventories to
**unknown**, not a synthetic single-worktree repository. Validate dangling project
references and tolerate partially populated inventories. No IndexedDB version
change is needed unless the actual storage structure changes.

## Helper discovery and boundaries

Introduce a focused `server/git-worktrees.ts` service and a pure parser/relationship
module under `src/lib` if shared parsing is useful. Extend the current scanner,
registry, and application rather than building a second discovery store.

1. Run ordinary bounded folder discovery. For detected Git checkouts, resolve
   and validate their top-level, private, and common Git directories. Use fixed
   argument arrays, the existing no-hooks/no-fsmonitor/no-lazy-fetch protections,
   and a controlled Git environment that cannot redirect repository selection.
2. Query worktree inventory once per canonical common directory per scan, sharing
   in-flight reads. Parse raw NUL-delimited output without trimming paths or
   relying on line splitting. Bound output bytes, record count, field lengths,
   command time, and concurrent subprocesses. Feature-detect required options;
   unsupported Git yields a useful warning while ordinary scanning continues.
3. Classify listed locations before filesystem inspection. Do not stat, scan, or
   register outside-folder checkout paths. For in-scope candidates, revalidate
   canonical containment and symlink protections, then verify their Git common
   identity matches the enumerated repository. A reported path is not sufficient.
4. Enqueue verified in-scope checkouts through the existing inspection path with
   a fresh checkout/package context. Explicit inventory entries may reach hidden
   containers such as `.worktrees/` or locations beyond ordinary depth limits;
   this does not authorize a general recursive search of hidden directories.
   Retain administrative, dependency, and build-directory exclusions.
5. Share the existing 500-folder and 300-project helper budgets across ordinary
   and inventory-led discovery. Reserve budget before awaits, deduplicate by
   canonical checkout/project path, prevent cycles, and stop with partial coverage.
   Keep browser discovery limits and access boundaries unchanged.
6. Discover packages independently within each admitted checkout using existing
   monorepo parsing. A nested listed worktree must not inherit its containing
   checkout's package workspace, even if a workspace glob matches its path.
7. Register a coherent result through `HelperApplication`, current root membership,
   revisions, and existing scan reservations. Never merge a partial newer attempt
   into a falsely complete older inventory. Expose truthful scan progress.

A linked checkout can legitimately use Git administrative data outside the
connected folder. Permit narrowly scoped Git metadata reads for the verified
checkout while keeping content discovery and filesystem actions inside the
selected root. Do not repurpose `gitDirectory` as the common administrative path
or relax `ProjectRegistry.get()` containment checks. Revalidate Git identity when
using relationships, including after a pointer change, path replacement, or move.
The metadata exception grants no authority to open or inspect sibling files.

Handle a bare main record as repository metadata, without inventing a runnable
checkout project. Supporting linked checkouts backed by a bare repository is in
scope; generic discovery of arbitrary bare repositories is not required initially.
Test submodules, separate Git directories, relative pointer layouts, and nested
repositories before treating private/common-directory differences as conclusive.

## Operation scopes and Git correctness

| Operation or data | Scope |
| --- | --- |
| README, documentation, metrics, scripts, working changes | Selected project/checkout files. |
| Package updates, dependency cleanup, maintenance guards and invalidation | Existing package workspace within one checkout, including related declared packages only. |
| Dev servers, logs, screenshots, Lighthouse startup | Existing project/process identity. Sibling worktrees can have independent processes; port conflicts must be reported without attaching to the wrong server. |
| Favorites, tags, ignored projects, cached previews and reports | Existing project ID; no copying from a sibling because its remote or package name matches. |
| Recent commits and selected checkout context | Selected checkout HEAD. |
| Daily summaries and repository-wide commit activity | Shared repository identity, with explicitly eligible checkout HEAD tips. |
| Push reminders | Shared unpushed-history result plus separately collected working-change state for each eligible checkout. |
| Public issues and PRs | Existing normalized remote identity. Preserve existing remote-activity semantics; do not assume every checkout has identical configuration. |

Split the current `summaryRepositories()` reuse into explicit history grouping
and checkout-status selection. Repository-wide history must include the existing
local/remote branch tips plus eligible in-scope checkout HEADs, including detached
tips. Deduplicate commits by repository ID and full object ID. Do not globally
deduplicate independent clones merely because commits have identical hashes.

Add aggregate variants under the existing project API pattern:
`POST /api/projects/:id/repository-history`, `/repository-daily-summary`, and
`/repository-push-status`. Requests carry `rootId`, `repositoryId`, a bounded list
of eligible `projectIds`, and the existing validated query fields where applicable.
The anchor and every requested project must be current members of that root and
repository; enforce caller grants as well for MCP. Derive unique checkout paths
and HEADs on the helper. Client IDs select among authorized members; they never
grant access or supply arbitrary paths/revision arguments.

Route these calls through the existing API/action hooks and shared application
services. Define typed aggregate responses containing repository identity and
coverage; push responses additionally contain per-checkout status rows. Ordinary
project endpoints retain their responses. Single-project History continues to
include local/remote refs plus the selected checkout's HEAD. The heatmap cache
must distinguish aggregate repository activity from that selected checkout's
history response so a narrower response cannot overwrite a complete aggregate.

Push reminders should show one shared repository result with named dirty
checkouts beneath it. Do not sum overlapping unpushed counts from sibling
responses, and do not choose just one checkout's dirty flag. Preserve unknown
origin refs, no-origin behavior, shallow coverage, failed reads, and partial HEAD
coverage. No network refresh, fetch, commit, or push is introduced.

Ignoring projects excludes those entries from browser-triggered checkout checks
and representative selection. If a nonignored package remains, its checkout may
still participate. Shared branch history can contain commits associated with an
ignored checkout, just as shared package inspection can see ignored package
dependencies; explain that ignore does not redact shared Git history.

Do not serialize every operation across sibling worktrees. Existing package and
process guards remain per checkout. Shared repository reservations become
necessary for later topology mutations; add them explicitly rather than changing
`ProjectRegistry.related()` to include all worktrees.

Review dev-server readiness before release: the runtime probes configured or
logged URLs, and two checkouts can advertise the same fixed port. An already
responding sibling is not evidence that the newly launched process is ready.
Track known port/process ownership, fail clearly on a collision, and prevent
preview/Lighthouse capture of the wrong checkout. Test both distinct dynamically
assigned ports and a fixed-port conflict, including a second process that exits.

## Refresh, persistence, REST, and MCP

Return inventory in the existing metadata scan response. Opening cards, branch
tooltips, and Worktrees uses snapshots. **Sync folder** and periodic metadata
scans refresh inventory. The current package-change watcher can skip scanning
when package fingerprints are unchanged, so adding or removing only a worktree
does not guarantee an automatic refresh in that mode. State this in help text
and keep **Sync folder** available. A future topology fingerprint can extend the
same watcher; the first release does not promise topology-only monitoring or add
a second polling loop.
Extend revisioned workspace reconciliation with the minimal inventory/membership
projection needed to observe scans from another tab or MCP client.

Retain workspace-generation, helper-instance, and revision checks on all merges.
An older scan cannot restore a removed checkout after a newer successful inventory.
A failed inventory refresh retains dated data with unavailable freshness, rather
than deleting siblings or declaring them gone. Successful authoritative discovery
can retire vanished membership; preserve orphaned favorites/tags under the existing
rules. Keep stop controls for helper-owned processes accessible even if their
checkout disappears, and do not silently abandon process ownership.

Preserve successful dated reports and cached previews on ordinary rescans and
failures. Package mutation attempts invalidate reports only in their actual
package workspace, including partial failure. A detected replacement of the Git
repository at the same path must prevent old repository relationships/history
from being presented as current; retain historical reports only as dated data
with unknown validity. Do not use branch names as cache keys for project identity.

Configuration imports should prefer exact compatible IDs and unambiguous paths.
An old remote-plus-package match that now names multiple worktrees is ambiguous;
report it and leave preferences untouched. Do not introduce branch-based matching,
since branches change. Any optional portable checkout hint needs explicit schema
validation and backward compatibility, not an implicit identity migration.

For MCP, project/root authorization remains independent of shared Git identity.
An authorized checkout does not grant sibling directory access. Filter inventory
before projection: unauthorized sibling paths, reason strings, counts, project
IDs, and detached HEAD metadata must not leak through nested records, warnings,
or pagination totals. `disclosePaths` governs authorized paths only. Test the
projection itself; existing string replacement is insufficient for new arbitrary
outside-root paths. Shared repository reads should document their shared-ref
scope and add only authorized checkout-specific tips.

Update MCP daily-summary deduplication and Git cache/cursor bindings to include
the relevant repository identity, eligible membership, and HEAD/ref snapshot.
Keep current grants and read capabilities; first-release support does not add
MCP Git mutation tools or automatic permissions. A worktree ID is never a way to
bypass `ProjectIndex.checkedEntry()` or current root membership.

## Delivery sequence

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 0. Fixtures and UX contract | Disposable worktree fixtures and static layout states covering the examples above; finalize shared types and scope labels. | Review can distinguish the target checkout in cards, search, details, and action labels without opening a tooltip. |
| 1. Discovery and identity | Inventory parser/service, bounded scanner expansion, registry references, browser fallback, optional cache normalization. | Real Git fixtures prove stable existing IDs, correct relationships, partial states, and no external content discovery. |
| 2. Operation and aggregate correctness | Scope audit, history/heatmap deduplication, checkout-aware reminders, configuration ambiguity handling, REST/MCP projection and reconciliation. | No duplicated shared commits, lost dirty sibling, cross-checkout invalidation, or scope disclosure. Detached HEAD coverage is tested. |
| 3. Library and navigation | List groups, grid context, Worktrees tab, search/filter support, accessible navigation and recovery states. | UI tests and visual review pass for the representative layouts and keyboard flows. |
| 4. First release | Integration, documentation, demo examples, performance review, complete regression checks. | All first-release acceptance criteria below pass; limitations are documented truthfully. |
| 5. Worktree management | Separate creation/removal implementation using the contract below. | Mutations have dedicated lifecycle, reservation, validation, and failure recovery tests before release. |

Phases 1 and the visual implementation in phase 3 can progress in parallel after
phase 0 fixes the contract. Phase 2 is a release dependency, not a later polish
task: a grouped library with incorrect reminders or maintenance scopes is unsafe
to ship. Update [architecture](../architecture.md), [frontend](../frontend.md),
[helper](../local-helper.md), and the [user guide](../../README.md) as each phase
actually ships, rather than documenting proposed behavior as already available.

## Later creation and removal

Plan these actions in the Worktrees tab, keeping everyday browsing uncluttered.
They require explicit UI actions; discovery, resync, and external changes must
never invoke them automatically.

**Create worktree** opens a form with a local starting branch/commit, a choice of
new or existing local branch, and a destination under the connected folder. Show
branch occupancy and the resolved destination before submission. Suggest a safe
sibling folder derived from a sanitized name, but keep branch and folder inputs
separate. Offer detached checkout only as an explicit advanced choice. Disable
submission for conflicting branches/paths and unsupported repository states.

The helper revalidates branch/ref syntax, allowed base revisions, repository
identity, path containment, symlink-free existing parents, and destination
nonexistence under a repository reservation immediately before running Git.
Do not use force, reset existing branches, guess remote branches, enable hooks,
initialize submodules, copy secrets or dependencies, install packages, or start
scripts. Define how checkout filters and lazy object retrieval are prevented or
reported before enabling this feature; creating files must not silently execute
project-configured commands or fetch missing objects.

After success, register/rescan the new checkout through the normal generation and
revision workflow, reveal it even if current filters hide it using an explicit
navigation result, and offer existing editor/development actions. If Git succeeds
but scanning fails, report **Worktree created; sync failed**, retain the destination,
and provide recovery. Do not retry creation automatically or recursively delete
partially created content on error.

**Remove worktree** is a secondary destructive action for an eligible linked
checkout. Review the exact path and branch and state that removing the checkout
does not delete its branch. Show owned running processes and require stopping
them through existing controls before removal. Reject the main checkout, locked
entries, changed/missing identities, dirty/untracked files, unsupported submodules,
and unknown status. Inventory ignored files too: `.env` files and other ignored
local assets must not be silently discarded merely because Git considers a tree
clean. Initially block removal with ignored contents and explain how to review
them externally; do not add a force-delete shortcut.

Recheck conditions under shared repository and checkout reservations, then invoke
the normal non-force Git removal command. Coordinate against package mutation,
scripts owned by the helper, captures, and scans; acknowledge that external
terminals cannot be reliably controlled. Remove current membership only on
confirmed success, update revisions, retain orphaned preferences, and restore
focus to the next valid worktree row. On failure, refresh status and show the
reason without assuming whether partial effects occurred.

Creation/removal needs a dedicated repository resource guard shared across tabs
and API adapters, reserved before asynchronous validation and released in all
cleanup paths. Any future MCP access needs separately designed mutation grants;
existing read/discovery/Git grants do not imply permission. Move, rename, prune,
repair, lock/unlock, branch switching, and multi-root libraries remain separate
follow-up decisions. Git's management constraints are documented in the
[worktree command reference](https://git-scm.com/docs/git-worktree).

## Verification and acceptance criteria

| Layer | Required behavior to verify |
| --- | --- |
| Parser and identity | Main/linked, detached, unborn, locked with/without reason, prunable, bare main, unknown fields, malformed/truncated output, spaces/Unicode/newlines, duplicate records, common-directory canonicalization, two clones with the same origin. |
| Real Git discovery | Connect to a parent folder and directly to a linked checkout; discover listed hidden/deep in-scope siblings; exclude outside paths; include monorepo packages separately in each checkout; handle bare-backed links, submodules and separate Git directories without false grouping. |
| Boundaries and races | Symlink escape, changed `.git` pointer, moved/replaced folder, deletion during scan/action, overlapping roots, traversal/output/time limits, missing Git/options, permission errors and partial inventory. |
| Runtime and maintenance | Separate server/log/preview targets; no false readiness or capture of a sibling on a fixed port; updates and cleanup invalidate only the selected package workspace; concurrent sibling operations retain correct guards and shutdown ownership. |
| Git views | Same commit counted once across siblings, separate clones counted independently, detached tips retained, all dirty eligible checkouts represented, ignored representative handling, shallow/missing/partial results preserved. |
| Frontend | Group after filtering, preserve sort and project counts, show duplicate-name context, navigate matching/missing packages, retain focus, reject late responses, preserve independent favorites/tags/ignore state, handle removed selection and disconnected helper. |
| Persistence and imports | Old caches/backups, helper restart, failed refresh preserving dated results, explicit invalidation, ambiguous remote matches, changed repository at the same path, stale revision/tombstone protection. |
| MCP | Authorized checkout cannot expose unauthorized sibling paths/counts/reasons/tips or enable actions; daily counts and cursor/cache invalidation follow scoped membership. |
| Performance | Inventory runs once per shared repository per scan, packages do not multiply subprocesses, all discovery shares existing budgets, no requests on card/tab hover or open. |

Extend existing colocated scanner, grouping, filter/search, details, hooks,
workspace, configuration, API, Git, runtime, and MCP tests. Add focused
worktree-service tests and real disposable Git fixtures rather than mocking every
Git response. Use the existing runtime/browser verification tools for visual QA;
do not invent an end-to-end script.

For implementation, run focused tests with `npm test -- <test-file>`, then finish
with `npm test` and `npm run build` under Node.js 22.12+ and npm.
Use `npm run doctor` when useful for the UI changes. Report Chromium skips or
environment failures explicitly. This planning-only change requires source/link
verification and `git diff --check`, not an application build.

The first release is ready when a user can find two checkouts of the same project,
identify their branches and paths, open the intended package, run existing actions
against the right files, and see accurate history and working-change summaries.
It must also preserve current behavior for repositories without linked worktrees
and explain external or unavailable checkouts without granting broader access.
