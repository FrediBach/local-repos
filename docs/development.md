# Development

## Setup and development runtime

Use Node.js **22.12 or newer** and npm, as declared in
[package.json](../package.json). This repository uses
[package-lock.json](../package-lock.json); the package managers supported for
scanned projects do not change the package manager used to develop Local Repos.
Git must be on `PATH` for helper Git features and Git-based tests.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5180`. The launcher starts Vite and the helper together and
stops both when either exits or the launcher receives a shutdown signal. Ports
`5180` and `4318` must be free. Keep the same browser origin while developing:
switching hostnames or ports gives you separate browser storage.

Preview capture and Lighthouse scans need Playwright's Chromium installation:

```sh
npx playwright install chromium
```

Other package managers and desktop applications are needed only for the helper
features that invoke them. The helper runs through `tsx` without automatic
server reload; restart it after changing server code. Vite handles frontend hot
updates.

## Daily use

Run `npm run build` once, then `npm run app` to serve the built frontend and
start the helper without source watching or hot reload. A missing build stops
startup with build instructions. After updating Local Repos, stop the app,
run `npm ci` and `npm run build`, then start it again. The helper still runs
through `tsx` from the current source; only the frontend is built into `dist/`.
Repository monitoring continues according to the app's Watcher settings.

Daily use and development share `http://127.0.0.1:5180` and its browser storage;
stop one before starting the other. Both launchers stop their children on Ctrl+C
or when either child exits. `npm run preview` remains a separate build preview
on port `4173` and does not start the helper.

The built app registers a service worker. When switching to development on the
same origin, if the browser keeps showing the built app, unregister the service
worker in browser developer tools and reload. Leave IndexedDB and localStorage
intact to preserve your workspace and preferences.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run app` | Serve the existing production browser build and start the helper on ports `5180` and `4318`, without source watching. |
| `npm run dev` | Start Vite with frontend hot reload and the helper for development. |
| `npm run dev:browser` | Start only Vite on loopback port `5180`; an independently running helper is still reachable through its proxy. |
| `npm run helper` | Start only the Node helper on loopback port `4318`. |
| `npm test` | Run the full Vitest suite once. |
| `npm test -- src/lib/metadata.test.ts server/scanner.test.ts` | Run selected test files while working on an affected area. |
| `npm run typecheck` | Run the TypeScript project references without emitting application code. |
| `npm run build` | Typecheck, then build the production browser app into `dist/`. |
| `npm run doctor` | Run the installed React Doctor CLI with verbose output and no score; review findings in context. |
| `npm run preview` | Serve `dist/` on loopback port `4173`, with `/api` proxied to a separately started helper. |
| `npm run assets:generate` | Regenerate the committed icons and social image from their SVG sources. |

There is no configured `lint`, formatter, or `test:e2e` script. Use the scripts
actually present in `package.json` when describing checks.

## Test structure and expectations

[vitest.config.ts](../vitest.config.ts) includes colocated tests under `src/`,
`server/`, and `config/`, uses the Node environment by default, and limits worker
concurrency to two. UI tests opt into jsdom with a file-level
`// @vitest-environment jsdom` comment and use React Testing Library and
`user-event`. Follow nearby tests for fetch, storage, timer, and process mocks.

Test the behavior at the layer being changed: pure parsing and report logic in
`src/lib`, user interactions in components/hooks and `App.*.test.tsx`, and request
validation, filesystem boundaries, command arguments, and lifecycle coordination
in `server/*.test.ts`. Build configuration has its own tests in `config/`.

The default suite includes real integration behavior. Helper tests create
temporary directories, Git repositories, loopback HTTP servers, and fixture
processes. The package outdated/update integration tests invoke npm against
local fixture registries with isolated configuration; the update fixture also
uses `tar` and installs fixture dependencies with lifecycle scripts disabled.
They do not require a public registry. The Lighthouse integration test audits a
disposable loopback HTML page with the installed Lighthouse package. Preview and
Lighthouse browser tests use installed Chromium and skip the relevant cases when
it is unavailable. A sandbox that
blocks loopback listeners or subprocesses can therefore prevent the suite from
running even when application code is correct.

Use temporary fixture projects for destructive or process-running behavior.
Do not point validation at a user's real repositories to exercise cleanup,
package updates, or script execution. Keep tests responsible for closing
listeners, stopping processes, deleting their temporary directories, and
restoring mocks and environment changes.

For application changes, run focused tests during development and the full
suite plus `npm run build` before handing off. A successful build already
includes typechecking. For documentation-only changes, check claims against
source, verify local links and command names, and run `git diff --check`; no
application build is needed. Report skipped or blocked checks explicitly.

## Build configuration and assets

[config/site.ts](../config/site.ts) generates HTML metadata, `robots.txt`, and,
for an indexable production origin, `sitemap.xml`. Optional `SITE_URL` must be an
HTTPS origin without a path, credentials, query, or fragment; see
[.env.example](../.env.example). Vercel environment variables provide fallback
origins and determine preview indexing. Do not expose arbitrary build
environment values to browser code.

The helper can accept an extra allowed origin from `LOCAL_REPOS_UI_ORIGIN` in its
process environment; this does not change its loopback binding or provide a
hosted-page connection. Vite loads `.env` files for its build configuration; the
helper entry point does not load them.

Brand sources are [public/favicon.svg](../public/favicon.svg) and
[design/og-image.svg](../design/og-image.svg).
[generate-brand-assets.mjs](../scripts/generate-brand-assets.mjs) renders the
committed PNG/ICO outputs. Social image generation needs Helvetica Neue,
Helvetica, or Arial installed locally. Ordinary builds consume the committed
images without regenerating them. Keep `dist/`, `node_modules/`, local `.env`
files, and build caches out of commits.

Use `npm run build` followed by `npm run app` (or a separate preview) to verify
service worker behavior: PWA service worker generation is not enabled for the development server. Deployment
and cache boundaries are described in [architecture.md](architecture.md); user
installation instructions remain in the [README](../README.md).

MCP integration tests in `server/mcp/mcp.test.ts` create protected temporary
policy files, disposable repositories, loopback helpers, and SDK HTTP/stdio
clients. They cover both protocol revisions without configuring a user's host
application or credentials. The bridge must be invoked with npm's `--silent`
option (or directly through `node --import tsx server/mcp/stdio.ts`) so npm does
not put its script banner on protocol stdout.
