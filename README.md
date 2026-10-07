# Local Repos

A local project library with README introductions, package details, technology filters, Git activity, and development previews. Built as a proof of concept with a light, restrained interface inspired by Dieter Rams.

## Run locally

Requires **Node.js 22.12 or newer** and npm. Git must be on your `PATH` for the helper's Git metadata.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5180**. This starts the Vite app and its local helper together. The helper listens on `127.0.0.1:4318`; Vite proxies `/api` requests to it. Both ports must be available.

Screenshot capture also needs Playwright's Chromium browser, installed once from this directory:

```sh
npx playwright install chromium
```

The initial screen contains labeled sample projects and illustrative previews. Connect your own directory to replace them.

## Connect your projects

Choose **Connect directory**, then use either connection method:

| Method | Available features | Requirements |
| --- | --- | --- |
| Choose a local directory | Read-only scanning, metadata, basic Git details, favorites, cached browsing | Desktop browser with `showDirectoryPicker`, such as Chrome or Edge; permission to read the selected folder |
| Connect with the local helper | Scanning, full Git CLI metadata, dev servers, screenshots, VS Code, Sourcetree, system file browser | Running helper and an absolute directory path, such as `/Users/you/Projects` |

The browser cannot reveal an absolute path or launch local processes. To enable local actions for a folder selected through the browser, reconnect it by entering its path in the helper form.

- Search names, descriptions, technologies, folder names, and branches. Use `⌘K` or `Ctrl+K` to focus search.
- Switch between grid and list views; filter by technology, favorites, or running servers.
- Open a project for its README, package metadata, current branch, latest commit, and origin link.
- Use **Synced …** to rescan. Changes are not watched continuously. A saved helper connection also rescans on app startup when the helper is available.
- Browser folder permissions can expire; resync may request read permission again.
- Use **How it works → Forget this directory** to remove the saved workspace. This does not delete project files.

Only one workspace is displayed at a time. Metadata, captured previews, favorites, and the browser directory handle are stored in IndexedDB for this browser and app origin. Switching between `localhost` and `127.0.0.1`, or between development and preview ports, creates separate browser storage.

## Run a project and capture a preview

Connect through the helper, open a project, and select **Start server** or **Capture preview**. Scanning never starts project scripts automatically.

Projects need a `dev` script in `package.json`, their dependencies already installed, and their package manager available on the helper's `PATH`. npm, pnpm, Yarn, and Bun are detected from package metadata and lockfiles. Local Repos does not install project dependencies.

Vite and Next.js development commands receive a local hostname and a free port. Other scripts must respect the `PORT` environment variable. The **Logs** action shows recent process output when startup fails.

**Capture preview** opens the root page in headless Chromium at 1440 × 900. It starts the project's server if needed and stops it afterward only if capture started it. An already running server stays running. Capture is manual and can be repeated to refresh the image.

Starting or capturing a project runs its actual development script with your local user permissions. Use these actions for projects you trust. Changing or forgetting a workspace stops its running servers before disconnecting. The helper also terminates the servers it owns when it shuts down normally; closing the app tab alone does not stop them.

## Production build and PWA

```sh
npm run build
npm run preview
```

Open **http://127.0.0.1:4173**. For local actions, start the helper in another terminal:

```sh
npm run helper
```

The production build includes a web app manifest, icons, and a service worker that caches the app interface. Visit it online once, then use the browser's install action, or **Install Local Repos** when the browser exposes the installation prompt. PWA installation does not install or start the Node helper.

The cached interface, saved project metadata, and captured previews remain usable offline. Fresh scans need folder access or the helper, and local actions need the helper. API responses are not part of the service worker's offline cache; captured images are stored with workspace data in IndexedDB. Service worker behavior is enabled in the production build, not the Vite development server.

For a UI-only development session, use `npm run dev:browser`.

## Architecture

- **Interface:** React, TypeScript, Vite, Tailwind CSS, shadcn-style components built on Radix primitives, and Lucide icons.
- **Browser scanning:** `src/lib/filesystem.ts` reads a user-granted File System Access API directory handle. `src/lib/metadata.ts` parses package metadata and extracts the first README prose paragraph without evaluating project code.
- **Local cache:** `src/lib/storage.ts` stores a workspace, captured preview data, and favorites with IndexedDB.
- **Local helper:** `server/scanner.ts` reads bounded metadata files and invokes Git. `server/runtime.ts` manages dev processes, Playwright screenshots, and application opening. `server/app.ts` exposes the local API.
- **PWA:** `vite-plugin-pwa` generates the manifest and production service worker.

The helper binds only to loopback, checks the request host and origin, rejects cross-site requests, and requires `X-Local-Repos: 1` on mutating API requests. Project actions accept registered project IDs rather than arbitrary commands. It is intended to run locally alongside the app, not as a public network service.

## POC limits

- Both scanners read the selected folder and up to two directory levels beneath it, stopping descent when a project is found. They skip hidden folders, dependencies, and common build output. Browser scanning is limited to 500 folders and 250 projects; helper scanning is limited to 500 folders and 300 projects.
- Browser Git details come from readable `.git` files and reflogs. Commit messages may be unavailable after a clone, packed metadata can be incomplete, and linked worktrees need the helper. Uncommitted-change detection is available through the helper.
- README summaries and technology labels are heuristics. README content is shown as text. Browser metadata reads are capped at 128 KiB; helper metadata files larger than 256 KiB are skipped.
- A repository is a single project entry; nested monorepo packages are not listed separately. Project detection uses `.git`, `package.json`, or supported language markers such as `pyproject.toml`, `Cargo.toml`, and `go.mod`.
- Server logs belong to the current helper session. The helper's temporary screenshot files are removed on normal shutdown; successfully cached previews survive helper restarts in IndexedDB. Browser storage limits or clearing site data can remove cached content.
- Capture visits the root URL without authentication and waits briefly for rendering. Apps requiring login, setup steps, a custom route, or a longer startup may need additional support.
- VS Code and file-browser opening depend on installed local applications. Sourcetree opening is implemented for macOS. Windows process launching and process-tree cleanup are not a supported, validated target of this POC.
- There is no automatic filesystem watching, background resync, bulk capture, or management of development servers launched outside Local Repos.

## Checks

```sh
npm run test
npm run typecheck
npm run build
```

Tests cover metadata parsing, browser scanning, helper scanning, and local API behavior. Build output is written to `dist/`.
