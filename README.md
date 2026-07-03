# Tasks Desktop

A non-touch, mouse-and-keyboard desktop app that reimplements the core functionality of
[Tasks.org](https://tasks.org) (lists, subtasks, due/start dates, priorities, recurrence, tags) as an
Electron + React + TypeScript app, with two-way CalDAV sync so it can share data with your existing
Tasks.org mobile setup (DAVx5 / Nextcloud / any Tasks.org-compatible CalDAV server).

## Installation

Grab the latest build for your platform from the
[Releases page](https://github.com/msdosfx/tasks-desktop/releases/latest).

### Windows (.exe)

Download `Tasks Desktop Setup x.y.z.exe` and run it. It installs per-user (no admin prompt) and
**automatically replaces any previously installed version** — settings and your task database are kept.
To remove the app: Windows Settings → Apps → Installed apps → Tasks Desktop → Uninstall.

From v0.1.9 onward the Windows app updates itself: it checks this repo's releases on startup, downloads
the new version in the background, and offers "Restart to update" in Settings, so you only ever need to
download the installer once.

### Debian / Ubuntu (.deb)

```bash
sudo apt install ./tasks-desktop_x.y.z_amd64.deb
```

`apt` resolves the dependencies automatically (plain `dpkg -i` works too, followed by
`sudo apt -f install` if it complains). Launch from your app menu, or run `tasks-desktop`.
Update by installing a newer .deb the same way; remove with `sudo apt remove tasks-desktop`.

### Flatpak (.flatpak)

A `.flatpak` bundle can't be launched directly — it must be installed with flatpak, and it needs the
shared runtimes it was built against (one-time setup):

```bash
# one-time: add Flathub and install the runtimes
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.freedesktop.Platform//24.08 org.electronjs.Electron2.BaseApp//24.08

# install and run the bundle
flatpak install "./Tasks Desktop-x.y.z-x86_64.flatpak"
flatpak run com.arlis.tasksdesktop
```

After that it appears in your app menu like any other app. Update by installing a newer bundle over it;
remove with `flatpak uninstall com.arlis.tasksdesktop`.

### macOS (.dmg)

The dmg is built for Apple Silicon (arm64). Open it and drag **Tasks Desktop** into **Applications**. The build is not code-signed, so the
first launch will be blocked by Gatekeeper — right-click (or Ctrl-click) the app in Applications and
choose **Open**, then confirm. This is only needed once. Update by installing a newer .dmg over the old
copy; remove by deleting the app from Applications.

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
npm run package  # build + bundle as DMG / NSIS installer / deb + flatpak via electron-builder
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
- Sync conflicts (same task edited on two devices between syncs) keep the server version on the synced
  task and preserve the local edits as a "(conflicted copy)" task; there's no merge UI yet.
- Only one level of subtasks is modeled (no infinitely nested subtasks).
- No notifications/reminders yet (Tasks.org supports local notifications; this would need
  `Notification` API + a due-date scheduler in the main process).
