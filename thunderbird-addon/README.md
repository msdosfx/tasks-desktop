# Tasks Desktop -> Thunderbird add-on (paused, blocked on a Thunderbird bug)

This is the MailExtension port described in `docs/thunderbird-addon-plan.md`.
It reuses `src/` (the React UI) unchanged; everything in this folder replaces
Electron's role (main process, preload, IPC, node:sqlite) with WebExtension
equivalents.

## Status: paused

Everything except CalDAV sync is built and confirmed working against a real
Thunderbird 152.0 install. Sync itself is blocked by what looks like a
genuine Thunderbird bug (not a bug in this code) -- see "The blocker" below.
Project is on hold until that's resolved or a different networking approach
is chosen; see "Options when resuming."

## Build

```
npm install          # picks up sql.js
npm run build:addon  # -> ../dist-addon
```

## Load into Thunderbird for testing

1. Tools/hamburger menu -> Developer Tools -> Debug Add-ons (opens an
   `about:debugging` tab; NOT "Browser Toolbox," which is a different,
   chrome-level debugger).
2. "Load Temporary Add-on..." -> select `dist-addon/manifest.json`.
3. Open the task list tab: easiest via the background console (Inspect ->
   Console) with `browser.tabs.create({url: browser.runtime.getURL("tab/index.html")})`.
   The toolbar/action icon placement was never tracked down during testing --
   worth another look, but not required to use the add-on.

Temporary add-ons unload when Thunderbird restarts, and get a new random UUID
on every "Load Temporary Add-on"/"Remove" cycle -- reload from
`about:debugging` after each restart.

## Confirmed working end-to-end

Full task/list CRUD, subtasks, due-date and category filtering (all
inherited unchanged from `src/`), storage persisted via sql.js (wasm SQLite)
+ IndexedDB, the `window.api` message-passing shim, and the
`browser.permissions.request()` flow wired into SettingsModal (prompts
appear on a real click, grants persist and show up correctly in
`about:addons`'s Permissions tab).

Two non-obvious fixes that were needed and are worth knowing about if this
gets picked back up:
- Extension pages get a restrictive default CSP that blocks WebAssembly
  outright; `manifest.json` needs `content_security_policy.extension_pages`
  to include `'wasm-unsafe-eval'`, or sql.js's wasm never compiles.
- sql.js's own internal fetch/streaming path for locating its `.wasm` file
  (via `locateFile`) reliably fails in a Thunderbird background page even
  though a plain `fetch()` of the exact same URL succeeds. `storage.ts`
  works around this by fetching the wasm bytes itself and passing them to
  `initSqlJs()` via the `wasmBinary` option instead of `locateFile`.

## The blocker

CalDAV sync needs the background script to talk to the user's CalDAV
server, which for nearly all self-hosted servers (Synology Calendar,
Radicale, Baikal, etc.) sends no CORS headers -- they were never built
expecting a browser-JS client. The documented fix for exactly this situation
is a granted WebExtension host permission: per MDN, an origin covered by
`host_permissions` gets "fetch access to those origins without cross-origin
restrictions."

That didn't hold up under test. Confirmed three separate ways, retesting
fresh (extension fully removed and reloaded) after each: (1) an optional
host permission requested at runtime via `browser.permissions.request()`
from a real button click, granted, and confirmed via
`browser.permissions.getAll()`; (2) the same origin declared as a static
`host_permissions` entry in the manifest; (3) the corresponding toggle
confirmed switched on under the add-on's own Permissions tab in
`about:addons`. In all three cases, both a plain `fetch()` typed into the
background page's own console and the real `tsdav`-issued request from
actual extension code still get blocked:

  Cross-Origin Request Blocked: The Same Origin Policy disallows reading
  the remote resource... (Reason: CORS header 'Access-Control-Allow-Origin'
  missing).

Full console output from each test: `../../thunderbird-cors-bug-console-log.txt`
(one level up, next to this repo, not inside it -- kept out of git on
purpose since it documents a specific LAN server).

A bug report is drafted (not yet filed) for
https://bugzilla.mozilla.org/enter_bug.cgi?product=Thunderbird. Confirmed
still reproducible on a fully up-to-date Thunderbird 152.0, so this isn't a
version that's already been patched.

## Options when resuming

- **Wait and retest** once Mozilla responds to/fixes the bug (file it first
  if it hasn't been filed yet).
- **Experiment API for privileged networking**: make the actual CalDAV HTTP
  calls with elevated/system principal, bypassing the WebExtension network
  stack's CORS enforcement entirely. This reintroduces the exact complexity
  the original plan (see `docs/thunderbird-addon-plan.md`) was designed to
  avoid, and is more fragile across Thunderbird version bumps -- only worth
  it if the bug sits unfixed for a long time.
- **Ruled out**: a server-side reverse proxy injecting CORS headers (e.g.
  Synology DSM's reverse proxy with custom response headers) does fix this,
  but was ruled out deliberately -- this is meant to be a commercially
  distributable add-on, and requiring every user to reconfigure their own
  CalDAV server's network setup isn't viable as a general solution.

## Still open regardless of the blocker above

- **Native menu shortcuts.** Electron's File/View/Account/Sync menu items
  (new task, new list, focus search, sync now, open settings) drove
  `window.api.on("shortcut:...")`. Only the single `_execute_action` command
  (open/focus the tab) is wired so far; the rest are inert until either more
  `commands` entries or the `menus` API are added.
- **Credential storage.** Per the agreed call, `encodePassword`/
  `decodePassword` in `background/caldav.ts` are plain base64, not real
  encryption -- same real-world protection Electron's own
  "encryption unavailable" fallback already had.
- **ATN review pass.** `web-ext lint`, confirm no minified/obfuscated
  bundles, and reconsider `optional_host_permissions: ["*://*/*"]` if AMO
  reviewers push back on the blanket grant (though per-account requests via
  `ensureHostPermission()` already narrow what's actually requested at
  runtime to the specific server the user enters).
- **Toolbar icon placement.** Never confirmed where/whether the `action`
  icon actually surfaces in Thunderbird's UI; opening the tab via the
  background console worked for all testing so far, but this needs a real
  fix before end users can use it without devtools.

## Files

- `manifest.json` -- MV3 manifest.
- `background/` -- the old `electron/main.ts` + `db.ts` + `caldav.ts` +
  `ical.ts`, ported. `index.ts` is the message router + alarm-driven sync.
  `storage.ts`/`sqlite-adapter.ts` are the sql.js + IndexedDB storage layer.
- `tab/` -- the extension page hosting `src/`'s existing React app;
  `api-shim.ts` replaces `electron/preload.cts`, including the
  `ensureHostPermission()` permission-request flow (must run here, not in
  the background script, since `permissions.request()` needs the tab's user
  gesture).
- `types/webextension-shim.d.ts` -- minimal local `browser.*` types (see the
  note at the top of that file about replacing it with the real
  `@types/firefox-webext-browser` package once you have registry access).
