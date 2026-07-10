# Tasks Desktop → Thunderbird add-on: path-of-least-resistance plan

## Verdict up front

Don't touch Thunderbird's native calendar backend (`browser.calendar` API is still in draft as of the March 2026 dev digest) and don't use Experiment APIs / native messaging for the MVP. Instead, ship the app as a **self-contained MailExtension** that opens in its own tab and runs its own CalDAV sync — exactly what it does today, just hosted inside Thunderbird's window instead of an Electron window. This sidesteps the two riskiest integration paths entirely and reuses most of the existing codebase.

## What carries over unchanged

- All React UI components (task list, sidebar, filters, category filter, settings modal layout) — none of it depends on Electron directly.
- `tsdav` (CalDAV client) and `ical.js` (VTODO parsing) — both are fetch-based JS libraries with no Node dependency, so they run as-is inside a WebExtension background/event script.
- Vite build setup — already outputs static HTML/JS/CSS; that's exactly what a MailExtension page needs.

## What needs a thin compatibility shim

- `window.api.*` calls (currently Electron `ipcRenderer.invoke` via preload) → replace with a shim that calls `browser.runtime.sendMessage` to a background script exposing the same function names. React components call `window.api.tasks.create()` etc. exactly as before; only the shim's internals change.

## What must be rebuilt

- **Storage**: `node:sqlite` doesn't exist in a WebExtension. Two options:
  - `sql.js` (SQLite compiled to WASM) — keeps your existing schema and queries almost verbatim, persist by serializing the DB to `browser.storage.local` or IndexedDB on change. Least rewrite of business logic.
  - Plain IndexedDB — more idiomatic for extensions, but means rewriting every query.
  - Recommendation: start with `sql.js` since subtasks/filters are exactly the kind of relational queries SQL is good at.
- **App shell**: `electron/main.ts`, preload script, and native menu all go away. Replace with `manifest.json` (Manifest V3 — required for new Thunderbird add-ons) + a background/event script + a browser_action or dedicated Tab that opens `index.html`.

## Dropped entirely

- electron-builder, deb/flatpak/dmg/nsis packaging, auto-updater, code signing, native window chrome/tray. Distribution becomes a `.xpi` (a zip) — sideload via `about:debugging` during dev, optionally sign/publish via addons.thunderbird.net later.

## Phased outline

1. **Scaffold the extension**: `manifest.json` (MV3), minimal background script, a Tab/browser_action that opens the existing React app's `index.html`. Get "hello world" loading inside Thunderbird via temporary install.
2. **Swap the app shell**: build the `window.api` shim over `browser.runtime.sendMessage`; move `accounts.ts`/`sync.ts`/CalDAV logic into the background script, called via messages instead of IPC.
3. **Swap storage**: port the SQLite schema to `sql.js`, add persistence to `browser.storage.local`/IndexedDB, re-run existing queries against it.
4. **Wire CalDAV sync end to end** inside the extension context; confirm accounts, discovery, and two-way sync work identically to the Electron version.
5. **Feature work** (the actual point of this move): subtasks, due-date filters, category filters — pure UI/data-layer work at this point, unconstrained by Thunderbird internals since the extension owns its own UI.
6. **Polish/distribute**: icon, `web-ext lint`, package as `.xpi`, decide on self-distribution vs. AMO/ATN listing.

## Optional, later, not required for MVP

Deeper Thunderbird integration (e.g., linking a task to a message, flagging from the message list) would need an Experiment API. Worth revisiting once the core add-on works, not before.

---

## Starter prompt for a new chat

```
I have an existing Electron desktop app called "Tasks Desktop" that I want to
turn into a Thunderbird add-on. It's React + TypeScript, uses node:sqlite for
storage, tsdav for CalDAV sync, and ical.js for VTODO parsing. Source lives at
C:\Users\Hunter\Documents\Claude\Projects\Tasks.org Desktop\tasks-desktop
(GitHub: precisioncrab/tasks-desktop).

Please read the source (src/, electron/, package.json) to get familiar with
the app, then let's work out an outline together for the path of least
resistance to port it into a Thunderbird MailExtension add-on. Known
constraints worth factoring in: Thunderbird's native browser.calendar
WebExtension API is still in draft/immature as of March 2026, so integrating
with it directly is risky; Experiment APIs and native messaging add real
complexity; node:sqlite and Electron IPC don't exist in a WebExtension
context and will need replacements. The end goal beyond the port itself is
adding subtasks, due-date filters, and category filters — features the app
doesn't have yet.

There's also a prior planning doc at docs/thunderbird-addon-plan.md in that
repo from an earlier conversation — feel free to check it, but let's
re-derive the outline together rather than just adopting it wholesale.
```
