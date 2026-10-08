# Local Repos

A local project library with README introductions, package search, vulnerability audits, outdated-package scans and bounded updates, monorepo workspaces, disk usage and dependency cleanup, technology filters, Git activity, and development previews. Built as a proof of concept with a restrained interface inspired by Dieter Rams, in light and dark themes.

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

## Appearance and keyboard navigation

Use the **System / Light / Dark** selector in the top bar to choose a theme. System follows your operating system and updates when it changes. The preference is saved locally and applied before the first paint; if browser storage is blocked, changes still work for the current session.

The interface uses larger, scalable text, higher-contrast colors, visible focus indicators, and reduced-motion support. Press **Tab** to reach **Skip to projects**. In a project dialog, use **Left / Right** to switch tabs, **Home / End** to reach the first or last tab, and **Escape** to close and return focus to the project. Dialog summaries and content can be scrolled with the keyboard.

## Connect your projects

Choose **Connect directory**, then use either connection method:

| Method | Available features | Requirements |
| --- | --- | --- |
| Choose a local directory | Read-only scanning, metadata, basic Git details, favorites, cached browsing | Desktop browser with `showDirectoryPicker`, such as Chrome or Edge; permission to read the selected folder |
| Connect with the local helper | Scanning, full Git CLI metadata, disk usage, dependency cleanup, package audits, outdated scans and minor/patch updates, dev servers, screenshots, VS Code, Sourcetree, system file browser | Running helper and an absolute directory path, such as `/Users/you/Projects` |

The browser cannot reveal an absolute path or launch local processes. To enable local actions for a folder selected through the browser, reconnect it by entering its path in the helper form.

- Search names, descriptions, technologies, folder names, branches, and package names. Choose **Package name & version** beside search to find only projects that declare a matching dependency. Use `next@16.2.1` for an exact version or `next@16.*.*` for a wildcard range. Matching declared versions appear on the project cards. Use `⌘K` or `Ctrl+K` to focus search.
- Switch between grid and list views; filter by technology, favorites, or running servers.
- Open a project for its README, package metadata, current branch, latest commit, and origin link.
- Use **Synced …** to rescan. Changes are not watched continuously. A saved helper connection also rescans on app startup when the helper is available.
- Browser folder permissions can expire; resync may request read permission again.
- Use **How it works → Forget this directory** to remove the saved workspace. This does not delete project files.

Only one workspace is displayed at a time. Metadata, captured previews, favorites, and the browser directory handle are stored in IndexedDB for this browser and app origin. Switching between `localhost` and `127.0.0.1`, or between development and preview ports, creates separate browser storage.

## Packages, disk usage, and maintenance

Open a project’s **Packages** tab to inspect its runtime, development, peer, and optional dependencies. Package search works with either connection method and matches names case-insensitively, including scoped names. Versions are the ranges or other specifications declared in the selected project’s `package.json`, not resolved or installed versions. Resync existing workspaces to load the new dependency metadata. Declared monorepo packages appear as separate searchable projects; transitive dependencies are not included in package search.

Add `@version` or `@range` to a full package name to find declarations compatible with that version or overlapping that range. For example, `next@16.2.1` matches `16.2.1`, `^16.0.0`, and `>=15`; `next@16.*.*` matches `^16.2.1` and `>=15`, but not `^15.0.0`. Scoped names work too, such as `@types/react@19.*.*`. Version search supports npm semver syntax, including `16.*`, `16.x`, `^16.0.0`, and `>=16 <17`. Prereleases follow npm’s explicit opt-in rules. Tags, local paths, Git URLs, aliases, and workspace/catalog protocols remain searchable by name but are not resolved for version searches. The same syntax works in both search scopes and the **Packages** tab; name-only searches still match partial names.

In **Overview → Disk usage**, select **Measure disk usage** to measure the entire project and its root `node_modules`. This requires the local helper and runs on demand; ordinary scans do not traverse dependency trees. Measurements include hidden files, Git data, and build output, use allocated disk blocks where available, count hard links once, and do not follow symlinks. Scans stop after 20 seconds, 250,000 entries, or 128 directory levels; incomplete results are explicitly shown as lower bounds. Measurements show their timestamp and also appear on project cards.

After measuring, **Delete node_modules** opens a confirmation for that project. It permanently removes only the root dependency directory, keeping source files, lockfiles, and nested workspace dependency directories outside that root `node_modules`. Linked or non-directory targets are rejected. The helper refuses cleanup while it is starting, running, or stopping that project’s development server, capturing a preview, measuring storage, auditing packages, or checking outdated versions. Stop other tools using the directory before deleting. Disk usage is measured again after deletion. Reinstall dependencies with the project’s package manager before running it again; Local Repos does not provide a general-purpose install action.

In **Packages → Scan for vulnerabilities**, the helper runs the detected package manager’s audit against the existing lockfile, including development dependencies. It supports npm, pnpm, Yarn Classic (1.16+), modern Yarn (2.4+), and Bun (1.2.15+). Bun requires a text `bun.lock`; binary-only `bun.lockb` projects receive an explanatory error. The package manager must already be installed. See the audit documentation for [npm](https://docs.npmjs.com/cli/v11/commands/npm-audit/), [pnpm](https://pnpm.io/cli/audit), [Yarn Classic](https://classic.yarnpkg.com/lang/en/docs/cli/audit/), [modern Yarn](https://yarnpkg.com/cli/npm/audit), and [Bun](https://bun.com/docs/pm/cli/audit). Audits do not install dependencies, run lifecycle scripts, or apply fixes. Modern Yarn’s temporary install-state cache is redirected outside the project and removed afterward.

Audits contact the configured package registry and send dependency names and versions. Results show severity counts, affected packages, vulnerable ranges, available fix information, and advisory links where supplied. Counts follow each package manager’s reporting conventions and configured advisory exclusions. Network errors, unsupported output, missing lockfiles, and timeouts are reported as failures, never as clean scans. Audits are limited to 60 seconds per command and 8 MiB of output. Windows audits currently require Bun; npm, pnpm, and Yarn command shims are not supported by this helper’s shell-free execution.

Disk measurements and successful package scan results are cached with timestamps, including across helper restarts. They describe the last measurement or scan: refresh disk usage or scan again after project changes. Failed scans keep the previous successful result visible.

Use **Scan vulnerabilities**, to the left of **Capture previews**, to audit every project in the workspace, including projects hidden by filters. The local helper processes one project at a time and saves each successful result immediately. Progress shows the current project, completed scans, projects with vulnerabilities, and failures. A missing package manifest or supported lockfile is reported for that project and the queue continues. **Stop after current** finishes the active audit and then stops; keep the app open while scanning. Preview capture, resync, directory changes, and other project actions are disabled until the scan finishes or stops.

Projects with reported vulnerabilities show a shield icon and count in both grid and list views. The color represents the highest reported severity: red for critical, orange for high, amber for moderate, blue for low, and slate for informational findings. Hover for the severity breakdown and last scan time, or click to open **Packages** and review the report. Clean and unscanned projects have no warning icon. A failed rescan keeps the previous result and its icon; a successful clean scan removes it.

Use **Packages → Scan for outdated packages** for one project, or **Scan outdated packages** above the project list for the whole workspace, including projects hidden by filters. Scans run one project at a time, save results immediately, and support **Stop after current**. The global progress panel sums lag points from successful results in that scan; failed projects retain their previous saved reports and do not contribute to that run’s total. No dependencies are installed or updated.

Outdated scanning uses the detected, already installed package manager: [npm](https://docs.npmjs.com/cli/v11/commands/npm-outdated/), [pnpm](https://pnpm.io/cli/outdated), [Yarn Classic](https://classic.yarnpkg.com/lang/en/docs/cli/outdated/), Yarn 2.3+’s [resolved package info](https://yarnpkg.com/cli/info) and [registry info](https://yarnpkg.com/cli/npm/info), or [Bun 1.2+](https://bun.sh/docs/pm/cli/outdated). It checks direct dependencies in the selected project’s manifest, including development and optional packages, against the configured registry. A regular manifest and the manager’s lockfile are required; resolved versions must be available to the manager. npm also falls back to exact versions in `npm-shrinkwrap.json` or `package-lock.json` when dependencies have been removed (lockfile versions 1–3; up to 8 MiB). Peer-only requirements, local/workspace/catalog/Git/aliased dependencies, and uncomparable versions are listed as skipped. Workspace members use the shared lockfile and are scanned separately; transitive dependencies are outside this scan. Commands are limited to 60 seconds and 8 MiB of output, with a 120-second deadline for the whole project scan. Modern Yarn uses two info commands; npm verifies omitted packages with up to four registry lookups at a time so silent omissions cannot be mistaken for current packages. Missing tools, unsupported output and registry errors fail the scan. Windows currently requires Bun or running the helper in WSL.

Outdated results compare current versions with the registry’s latest version. Each package contributes points from its highest changed version component: **10 per major version**, **1 per minor version (up to 5)**, or **0.1 per patch version (up to 1)**. A prerelease-only gap contributes 0.1. Lower components are ignored when a higher component differs, and versions ahead of the latest release are not scored as outdated. The project’s lag score is the sum of those points; it indicates version distance, not release age or security risk.

Project cards show a package icon and lag score in both views. Small gaps use muted styling. Amber indicates a major upgrade or a score of 10 or more. **Red requires at least 100 points and at least one package two or more major versions behind.** Numerous small updates alone never trigger red. Click the icon for current/latest versions, per-package points, scoring details, and the last successful scan time. Uncomparable packages are listed as skipped and excluded from the score, so partial results are never presented as fully up to date.

## Monorepos

Both connection methods discover workspace patterns from `package.json` (`workspaces` arrays or `workspaces.packages`) and `pnpm-workspace.yaml`, including glob patterns and `!` exclusions. Each package appears separately with its own scripts, dependencies, README, preview, and development server. Labels identify its parent repository and package path. Members inherit the root package manager and Git information. Resync to discover newly added members.

The helper uses the shared lockfile for package maintenance. Outdated scans and updates target the selected member; vulnerability audits cover the shared workspace lockfile and may report findings from sibling packages. Updates and dependency cleanup are blocked while a related server, preview, or maintenance action is active. Dev servers for separate apps can run independently.

## Minor and patch updates

After an outdated scan, use **Packages → Update patches** or **Update minor versions** with the local helper:

- **Update patches** finds the highest stable release within the installed major and minor version (for example, 1.2.0 → 1.2.4).
- **Update minor versions** includes patches and finds the highest stable release within the installed major version (for example, 1.2.0 → 1.9.3).

Each action refreshes resolved versions and queries published releases, including compatible releases on older major lines. It updates direct runtime, development, and optional dependencies with simple numeric, caret, or tilde declarations. Peer-only requirements, duplicate declarations across dependency groups, complex ranges, prereleases, and local/workspace/catalog/Git/aliased dependencies are skipped and reported.

Updated dependencies are **pinned to exact versions** in package.json. The installed package manager updates its lockfile and dependency tree; a workspace member uses the shared lockfile. Lifecycle scripts are disabled. Other dependencies may be resolved by the package manager as part of installation. An installation failure can leave partial changes, so inspect the files before retrying. Outdated, audit, and storage reports are cleared for the related repository after an update attempt, and project metadata is refreshed. Scan again for fresh reports.

Commands use [npm install](https://docs.npmjs.com/cli/install/), [pnpm add](https://pnpm.io/cli/add), [Yarn add](https://yarnpkg.com/cli/add), or [Bun add](https://bun.sh/docs/pm/cli/add), depending on the project. No major version updates, forced peer-dependency overrides, or automatic updates are performed. Following the initial outdated scan, registry lookups and installs have a combined four-minute deadline, a two-minute per-command timeout, and an 8 MiB output limit.

## Run a project and capture a preview

Connect through the helper, open a project, and select **Start server** or **Capture preview**. Scanning never starts project scripts automatically.

Use **Capture previews**, beside **Change directory**, to capture every project in the workspace one at a time using the **Automatic** source. This includes projects hidden by the current filters. Progress shows the current project, completed count, successes, and failures; each successful preview updates the list and browser cache immediately. A failed capture keeps the previous image and continues to the next project. **Stop after current** finishes the active capture and its server cleanup before stopping the queue. Keep the app open while capturing; closing or reloading it discards the remaining queue.

Local startup uses the first available `dev`, `start`, or `serve` script in `package.json`. Projects need their dependencies already installed and their package manager available on the helper's `PATH`. npm, pnpm, Yarn, and Bun are detected from package metadata and lockfiles. Local Repos only installs dependencies when you explicitly choose a package update action.

Common Vite/SvelteKit, Next.js, Astro, Nuxt, Angular, Vue CLI, webpack, Parcel, and Create React App commands are recognized. Existing host and port settings are respected; supported commands receive a local hostname and free port when needed. Custom scripts can use the `PORT` environment variable or print a local HTTP(S) URL in their logs. The helper follows these announced URLs, including paths, instead of assuming every server runs on the assigned port. Use **Logs** to inspect startup failures.

Choose a preview source beside **Capture preview**:

- **Automatic** tries an explicit `localRepos.previewUrl` first, then the local app, then `package.json`'s `homepage`, and finally the public GitHub repository's About → Website setting, found through its Git origin. An unavailable or blank page allows the next source to be tried.
- **Local** tries the local app, then image assets in its repository, without looking up a deployed website.
- **Project URL** skips local startup and tries the configured preview URL, package homepage, and GitHub website. This also works for projects without a runnable development script.

Add these optional fields to a project's `package.json` to configure its deployed website or a specific preview route:

```json
{
  "homepage": "https://example.github.io/my-project/",
  "localRepos": {
    "previewUrl": "https://demo.example.com/my-project?theme=light#/gallery"
  }
}
```

URLs must be absolute HTTP(S) addresses without embedded credentials. Paths, query parameters, and hashes are preserved. Repository pages are not used as app previews. After updating Local Repos, restart `npm run dev` to load the new helper; use **Synced …** to rescan your projects and load their URL metadata. Rescan after later changes to those package fields too.

Capture opens a fresh, unsigned-in Chromium page at 1440 × 900. It waits for visible content, fonts, images, and layout changes to settle, then retries nearly uniform images instead of caching a blank white preview.

If every eligible page fails, capture looks for an **Open Graph image**, then a **logo**, then a **favicon**. It checks website metadata and, in Automatic or Local mode, common image files in the repository. Project URL mode uses website assets only. Missing, corrupt, or unsupported images are skipped. Asset previews are converted to PNG and cached just like screenshots, so they work offline and survive helper restarts. Logos and icons are centered without stretching, and the project details identify the image kind and source webpage or repository path. This fallback also runs during **Capture previews** batches. If no usable image is found, the previous preview stays in place and the error includes available capture diagnostics. Capture can be repeated to refresh the preview.

A local capture starts the project's server if needed and stops it afterward only if capture started it. An already running server stays running. Starting a server or capturing locally runs the project's actual script with your local user permissions; use these actions for projects you trust. Changing or forgetting a workspace stops its running servers before disconnecting. The helper also terminates the servers it owns when it shuts down normally; closing the app tab alone does not stop them.

Fresh scans read local metadata only and make no website or GitHub requests. Capturing a website contacts that site; GitHub fallback may also query the public GitHub API. The lookup does not use GitHub tokens or your signed-in session, so private repositories, rate limits, and missing website settings can prevent discovery. A package homepage or explicit preview URL can supply the website directly.

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

## Deploy to Vercel

Import this repository into Vercel with the repository root as the project directory. The checked-in `vercel.json` selects Vite, installs the lockfile with `npm ci`, runs `npm run build`, and publishes `dist/`. This deploys the browser app: demo projects, read-only directory access in supported browsers, and the installed PWA.

**The local helper is not deployed.** Vercel cannot access files or start development servers on a visitor's computer. To use helper features, run Local Repos locally and open `http://127.0.0.1:5180`, or use the local production preview described above. Starting the helper alone does not connect a Vercel-hosted page to it.

Vercel deployments automatically show a hosted-version dialog explaining browser features and local-only actions, with a link to the [GitHub installation instructions](https://github.com/FrediBach/local-repos#run-locally). Dismissal is remembered for the current tab session; **Hosted version** in the top bar reopens it. The connection dialog offers browser folder access and local installation guidance. Detection uses Vercel's build-time `VERCEL=1` flag for custom domains, with a `*.vercel.app` hostname fallback. Loopback addresses always keep the local experience.

Set the optional **`SITE_URL`** environment variable to your preferred public HTTPS origin, such as `https://your-domain.example`, then rebuild. It must not include a subdirectory, credentials, query, or fragment. Without it, the build uses `VERCEL_PROJECT_PRODUCTION_URL`, falling back to `VERCEL_URL`. Keep Vercel's **Enable access to System Environment Variables** setting enabled; see [Vercel's system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). For another static host, copy `.env.example` to `.env.local` and set `SITE_URL` before building.

The production HTML includes a description, canonical URL, Open Graph and Twitter large-image cards, and WebApplication structured data. The same public origin is used for `/og-image.png` and the single-page `/sitemap.xml`. `/robots.txt` allows the public app and excludes `/api/`. Vercel preview, development, and custom nonproduction environments receive `noindex, nofollow` and disallow crawling, with no sitemap. Local builds without a public URL also omit canonical URLs and the sitemap and are marked noindex. Rebuild for the production environment when promoting a preview.

The app uses only `/`; projects and filters are local UI state. There is deliberately no catch-all rewrite, so missing assets, unknown paths, and `/api` requests remain 404s on Vercel. The service worker likewise only falls back to the app for root-page navigation. HTML, the manifest, service worker, and unversioned images revalidate; hashed `/assets/` files can be cached for a year. Response headers prevent framing and MIME sniffing, restrict referrer disclosure, and disable unused camera, microphone, and geolocation access. The configuration follows [Vercel's static configuration reference](https://vercel.com/docs/project-configuration/vercel-json).

The manifest includes a stable app ID, root scope, language, categories, theme colors, and install icons. The 192px and 512px icons have an opaque background, with the mark inside the maskable safe area; a separate 180px Apple touch icon and 32px ICO cover other launchers. To regenerate the checked-in images from `public/favicon.svg` and `design/og-image.svg`, run `npm run assets:generate`. The social image uses locally installed Helvetica Neue, Helvetica, or Arial fonts; regenerate it on a machine with one of those fonts. Ordinary builds use the committed PNGs and do not need a font or image-rendering step.

## Architecture

- **Interface:** React, TypeScript, Vite, Tailwind CSS, shadcn-style components built on Radix primitives, and Lucide icons.
- **Browser scanning:** `src/lib/filesystem.ts` reads a user-granted File System Access API directory handle. `src/lib/metadata.ts` parses package metadata and extracts the first README prose paragraph without evaluating project code.
- **Local cache:** `src/lib/storage.ts` stores a workspace, captured preview data, and favorites with IndexedDB.
- **Local helper:** `server/scanner.ts` reads bounded metadata files and invokes Git. `server/runtime.ts` manages dev processes, Playwright screenshots, and application opening. `server/app.ts` exposes the local API.
- **Maintenance:** `server/project-storage.ts` measures disk usage and removes root dependencies; `server/package-audit.ts` runs and normalizes package manager audits; `server/package-update.ts` resolves and installs bounded updates; `server/package-outdated.ts` checks available versions and `src/lib/outdated.ts` calculates conservative lag scores. Runtime guards coordinate these actions with server and preview work.
- **PWA:** `vite-plugin-pwa` generates the manifest and production service worker.

The helper binds only to loopback, checks the request host and origin, rejects cross-site requests, and requires `X-Local-Repos: 1` on mutating API requests. Project actions accept registered project IDs rather than arbitrary commands. It is intended to run locally alongside the app, not as a public network service.

## POC limits

- Both scanners read the selected folder and up to two directory levels beneath it, stopping descent when a project is found unless it declares workspaces (searched up to eight levels beneath their root). They skip hidden folders, dependencies, and common build output. Browser scanning is limited to 500 folders and 250 projects; helper scanning is limited to 500 folders and 300 projects.
- Browser Git details come from readable `.git` files and reflogs. Commit messages may be unavailable after a clone, packed metadata can be incomplete, and linked worktrees need the helper. Uncommitted-change detection is available through the helper.
- README summaries and technology labels are heuristics. README content is rendered as Markdown with GitHub-style tables, task lists, and strikethrough; embedded HTML is ignored. Browser metadata reads are capped at 128 KiB; helper metadata files larger than 256 KiB are skipped.
- Workspace roots and their declared package members are separate project entries. Workspaces must be declared in package.json or pnpm-workspace.yaml; undeclared nested packages are not discovered. Project detection uses `.git`, `package.json`, or supported language markers such as `pyproject.toml`, `Cargo.toml`, and `go.mod`.
- Server logs belong to the current helper session. The helper's temporary screenshot files are removed on normal shutdown; successfully cached previews survive helper restarts in IndexedDB. Browser storage limits or clearing site data can remove cached content.
- Captures use a fresh browser session without authentication. Apps requiring login or interactive setup cannot be previewed automatically. Local startup has a 45-second readiness limit; each page capture has a 25-second rendering limit. A configured project URL can bypass local startup or select a custom route.
- GitHub website discovery supports public repositories on `github.com`. Other Git hosts need a package homepage or explicit preview URL. A deployed preview may differ from your local branch or uncommitted changes.
- VS Code and file-browser opening depend on installed local applications. Sourcetree opening is implemented for macOS. Windows local dev-server startup and process-tree cleanup are not supported; **Project URL** capture does not require launching a local dev server and needs the helper and Chromium.
- There is no automatic filesystem watching, background resync, or management of development servers launched outside Local Repos.

## Checks

```sh
npm run test
npm run typecheck
npm run build
```

Tests cover metadata parsing, browser scanning, helper scanning, and local API behavior. Build output is written to `dist/`.
