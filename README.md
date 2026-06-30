# Tasks Desktop

A non-touch, mouse-and-keyboard desktop app that reimplements the core functionality of
[Tasks.org](https://tasks.org) (lists, subtasks, due/start dates, priorities, recurrence, tags) as an
Electron + React + TypeScript app, with two-way CalDAV sync so it can share data with your existing
Tasks.org mobile setup (DAVx5 / Nextcloud / any Tasks.org-compatible CalDAV server).

## Stack
- Electron (main process) + Node's built-in `node:sqlite` for local storage (no native compiler required)
- React + TypeScript (renderer), built with Vite
- `tsdav` for CalDAV discovery/sync, `ical.js` for VTODO parsing/generation

## Setup

```bash
cd tasks-desktop
npm install
```

No native build tools (Visual Studio Build Tools, Python, etc.) are required — storage uses Node's
built-in `node:sqlite` module instead of a compiled native addon, so this should install cleanly on both
Windows and Linux with just Node and npm.

If `node:sqlite` isn't available in the Electron version that gets installed (it needs an Electron build
on Node 22.5+), `npm install electron@latest` to pick up a newer one. If the app still fails to start with
an error mentioning `node:sqlite` or `ERR_UNKNOWN_BUILTIN_MODULE`, add `--experimental-sqlite` to the
`electron .` command in the `dev:electron` / `start` scripts in `package.json`.

## Running in development

Open two terminals from the project folder:

```bash
# terminal 1 — Vite dev server for the renderer
npm run dev

# terminal 2 — compile + launch Electron, pointed at the dev server
npm run dev:electron
```

## Production-style run / packaging

```bash
npm start      # build renderer + electron main, then launch
npm run package  # build + bundle as a DMG/NSIS/AppImage via electron-builder
```

## Features implemented
- Lists sidebar (custom lists, "All Tasks", "Today & Overdue"), create/select lists
- Tasks: title, notes, start date, due date, priority (None/High/Medium/Low), tags, recurrence (RRULE,
  with quick presets for daily/weekly/monthly/yearly plus a custom-RRULE field)
- Subtasks (one level), shown nested under their parent and in the detail panel
- Search across title/notes/tags, right-click context menu (complete/duplicate/delete), keyboard
  shortcuts (Ctrl+N new task, Ctrl+Shift+N new list, Ctrl+F search, Ctrl+R sync, N new task, Delete to
  remove the selected task) — fully mouse/keyboard driven, no touch gestures anywhere
- CalDAV accounts screen: add a server (label, URL, username, password/app-token), test the connection,
  discover its calendars, and link any local list to a remote calendar
- Two-way sync engine (`electron/caldav.ts`): pulls new/changed remote VTODOs into the local DB, pushes
  new/changed local tasks to the server, and propagates local deletions

## Known limitations / next steps
- Built and reviewed by hand without network access to `npm install` or run Electron, so treat the first
  run as a shakeout — check the terminal for TypeScript or runtime errors and report back anything that
  needs fixing.
- Recurrence is stored as an RRULE string but completing a recurring task does not yet auto-generate the
  next occurrence — that's the next logical feature to add.
- Sync conflict resolution is "last write wins" by etag comparison; no merge UI for conflicts yet.
- Only one level of subtasks is modeled (no infinitely nested subtasks).
- No notifications/reminders yet (Tasks.org supports local notifications; this would need
  `Notification` API + a due-date scheduler in the main process).
