# Working on Local Repos

These instructions apply throughout this repository.

## Start here

- Read [docs/architecture.md](docs/architecture.md) for the system boundaries and
  source map, then [docs/frontend.md](docs/frontend.md) or
  [docs/local-helper.md](docs/local-helper.md) for the area you are changing.
- Use [docs/development.md](docs/development.md) for commands and test setup and
  [README.md](README.md) for existing user-facing behavior.
- Inspect the working tree and nearby implementation/tests before editing.
  Preserve unrelated changes and keep the diff focused on the requested work.
- Document implemented behavior. Update relevant architecture docs when changing
  boundaries, data flow, persistence, or workflows, and update the README when
  user-visible behavior or setup changes.

## Environment and verification

- Use Node.js **22.12+** and npm. Install from `package-lock.json` with `npm ci`;
  update the lockfile alongside deliberate dependency changes.
- `npm run dev` starts Vite at `127.0.0.1:5180` and the helper at
  `127.0.0.1:4318`. Restart the helper after server edits. `npm run dev:browser`
  starts only Vite. Screenshot capture needs `npx playwright install chromium`.
- Run focused tests with `npm test -- <test-file>`. For application changes,
  finish with `npm test` and `npm run build`; the build includes typechecking.
  `npm run typecheck` is available for a faster type-only check, and
  `npm run doctor` provides additional React diagnostics when relevant.
- Tests are colocated and run with Vitest. UI tests opt into jsdom and use React
  Testing Library. The default suite also includes temporary filesystem/Git
  fixtures, loopback servers, subprocesses, and real npm integration tests.
  Chromium-dependent tests can skip when its browser binary is absent. Report
  skips and environment failures; do not treat them as passing coverage.
- For documentation-only edits, verify source claims, local links, script names,
  and `git diff --check`. Do not add tests that only mirror documentation.
- There is no `lint` or `test:e2e` script. Do not invent checks or report a check
  you did not run. Summarize what changed, what was verified, and any remaining
  limitations when handing off.

## Code organization and conventions

- Match the surrounding TypeScript style: strict types, explicit type imports,
  single quotes, and no routine semicolons. Avoid unrelated formatting changes.
- Use `@/` imports within browser code where appropriate. Server code uses
  relative imports, including imports of shared types and pure domain modules
  from `src/`. Keep shared modules free of browser-only and Node-only side
  effects; never pull Node APIs into the browser bundle.
- Keep UI composition in components, stateful workflows in hooks, pure domain
  logic in `src/lib`, HTTP dispatch in `server/app.ts`, and helper operations in
  the relevant server service. Extend existing abstractions before introducing
  another state store, router, or process runner.
- Update [src/types.ts](src/types.ts) and both sides of the API when changing a
  shared contract. Treat persisted workspaces and settings as older data that
  may omit newly added fields; preserve normalization and fallback behavior.
- Reuse `src/components/ui`, existing feature styles, and `src/theme.css` tokens.
  Preserve light/dark themes, keyboard access, focus restoration, accessible
  labels, and reduced-motion behavior in UI changes.

## Contracts to preserve

- Browser directory access is read-only and cannot provide absolute filesystem
  paths or run processes. Gate helper-only features accordingly, including in
  demo and hosted modes. Keep browser and helper discovery consistent through
  the shared metadata and monorepo parsers and corresponding scanner tests.
- Treat project IDs as durable cache identities. Browser and helper IDs are
  different; changes affect favorites, tags, report matching, and configuration
  imports. Do not silently reset saved preferences during rescans.
- Preserve dated successful reports and cached previews on ordinary rescans and
  failed checks. Represent unavailable, skipped, partial, and failed results
  honestly; missing data must not become a clean audit or an up-to-date result.
  Package update attempts must invalidate reports in the affected package
  workspace, including failures because an install can partially succeed.
- Route client operations through the existing API/action hooks. Preserve the
  global busy state, workspace generation guards, batch stop-after-current
  behavior, and watcher coordination so late responses cannot overwrite a new
  workspace.
- Visual monorepo grouping does not necessarily mean shared package maintenance.
  Use `packageWorkspaceId()` and the registry's related-project semantics;
  `declaredWorkspace: false` means independently maintained packages.
- Keep the helper bound to loopback. Preserve host/origin checks, cross-site
  rejection, the `X-Local-Repos: 1` request header, request validation, and
  registered-project IDs. Resolve filesystem actions through
  `ProjectRegistry.get()` and retain canonical-path and containment checks.
- Keep metadata scanning bounded and free of project-code execution. Preserve
  symlink protections, traversal limits, subprocess deadlines, output limits,
  and shell-free argument arrays where used. Never turn request input into an
  arbitrary command or filesystem action.
- Extend helper concurrency guards alongside new operations. Reserve guards
  before asynchronous work, account for related workspace packages, and release
  resources in cleanup paths. Process shutdown must stop owned processes and
  close browsers, listeners, and temporary resources.
- Keep package inspection separate from mutation. Minor/patch updates must
  retain version bounds and disabled lifecycle scripts; dependency cleanup must
  retain its explicit confirmation and restricted target. Revalidate a project
  script's name and displayed command against the current manifest before
  launching it. Use disposable fixtures for testing these operations.
- Keep Git inspection local: do not introduce fetch, commit, or push side effects
  into scanning, summaries, or reminders.
- The deployed app is static and uses `/` as its only route. Preserve the API and
  missing-asset exclusions from PWA navigation fallback and hosted routing.
  Do not expose build secrets or deploy the local helper as a public service.

## Generated files

Do not hand-edit generated outputs. Keep `dist/`, `node_modules/`, local
environment files, and build caches out of commits. Brand image outputs in
`public/` are intentionally committed: change their SVG sources and run
`npm run assets:generate` when those assets need an update. Keep ordinary feature
work separate from generated-asset churn.
