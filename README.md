# Tasks Desktop

A non-touch, mouse-and-keyboard desktop app that reimplements the core functionality of
[Tasks.org](https://tasks.org) (lists, subtasks, due/start dates, priorities, recurrence, tags) as an
Electron + React + TypeScript app, with two-way CalDAV sync so it can share data with your existing
Tasks.org mobile setup (DAVx5 / Nextcloud / any Tasks.org-compatible CalDAV server).

> **Beta software.** This project is still in active development and hasn't reached a stable 1.0 yet.
> Expect rough edges and bugs, and keep a backup of anything important — while sync is two-way, you
> shouldn't rely on this as the only copy of your tasks until a v1.0 release. Bug reports are welcome
> on the [issue tracker](https://github.com/precisioncrab/tasks-desktop/issues).

## Installation

Grab the latest build for your platform from the
[Releases page](https://github.com/precisioncrab/tasks-desktop/releases/latest).

### Windows (.exe)

Download `tasks-desktop-Setup-x.y.z.exe` and run it. It installs per-user (no admin prompt) and
**automatically replaces any previously installed version** — settings and your task database are kept.
To remove the app: Windows Settings → Apps → Installed apps → Tasks Desktop → Uninstall.

From v0.1.14 onward the Windows app updates itself: it checks this repo's releases on startup, downloads
the new version in the background, and offers "Restart to update" in Settings, so you only ever need to
download the installer once. (Versions 0.1.9–0.1.13 shipped with a broken update check — if you're on
one of those, download and run the latest installer manually once; after that updates are automatic.)

### Debian / Ubuntu (.deb)

```bash
sudo apt install ./tasks-desktop_x.y.z_amd64.deb
```

`apt` resolves the dependencies automatically (plain `dpkg -i` works too, followed by
`sudo apt -f install` if it complains). Launch from your app menu, or run `tasks-desktop`.
Update by installing a newer .deb the same way; remove with `sudo apt remove tasks-desktop`.

### Flatpak (auto-updating)

Tasks Desktop is published as a proper Flatpak repository, so you install it once and then
`flatpak update` (or GNOME Software / KDE Discover) keeps it current automatically:

```bash
# install once from the repository (pulls the runtimes it needs from Flathub)
flatpak install --from https://precisioncrab.github.io/tasks-desktop/tasks-desktop.flatpakref

# run it
flatpak run com.arlis.tasksdesktop
```

After that it appears in your app menu like any other app. To update:

```bash
flatpak update
```

Remove it with `flatpak uninstall com.arlis.tasksdesktop`. (If you have a Flathub remote already, the
required runtimes install automatically; if not, the `.flatpakref` points at Flathub so they're fetched
on first install.)

A standalone `.flatpak` bundle is also attached to each [GitHub release](https://github.com/precisioncrab/tasks-desktop/releases/latest)
for offline installs, but the repository above is the recommended path since it's the one that
auto-updates.

### macOS (.dmg)

Two dmgs are published: `arm64` for Apple Silicon (M1 and later) and `x64` for Intel Macs — pick the
one matching your machine (About This Mac shows which chip you have). Open it and drag **Tasks Desktop**
into **Applications**. The build is not code-signed, so the
first launch will be blocked by Gatekeeper — right-click (or Ctrl-click) the app in Applications and
choose **Open**, then confirm. This is only needed once. Update by installing a newer .dmg over the old
copy; remove by deleting the app from Applications.

## Connecting a CalDAV / CardDAV server (Synology, Nextcloud, …)

Tasks Desktop syncs **tasks & calendars over CalDAV** and **contacts over CardDAV**. Open **Settings**
(the "CalDAV / CardDAV accounts…" button in the sidebar) → **Add account** and fill in:

- **Server URL — CalDAV** — the calendars/tasks endpoint.
- **CardDAV URL — contacts** (optional) — the contacts endpoint. On some servers this is a *different*
  address than CalDAV (notably Synology); on others (Nextcloud) it's the same base URL.
- **Username** and **Password / app token**.

Click **Test connection** — it reports how many calendars **and** address books it found, so you can
confirm the URLs before saving. After saving, use the account's **Find calendars** to link lists, and the
**Contacts (CardDAV)** section to **Find address books** and link them.

> **Self-hosted server over HTTPS?** NAS boxes (Synology, etc.) usually use a **self-signed
> certificate**, which the app rejects by default. If HTTPS gives "fetch failed" but HTTP works, tick
> **Allow self-signed certificates** in Settings — only do this for servers you trust on your own network.

### Synology — Calendar and Contacts URLs live in different places

Synology serves CalDAV and CardDAV as **separate services at different addresses**, so enter both.

- **CalDAV (Calendar):** open the **Synology Calendar** app → **Settings** (gear, top-right) → **CalDAV
  Account**. The URL looks like:

  ```
  http://<nas-ip>:5000/caldav.php/          # or https://<nas-ip>:5001/caldav.php/ over HTTPS
  ```

- **CardDAV (Contacts):** the contacts service is separate and, by default, listens only on the loopback
  address (port 5555). Give it a reachable HTTPS port first:
  **Control Panel → System → Login Portal → Applications → Synology Contacts → set an HTTPS port**
  (e.g. your DSM HTTPS port, 5001). Then the CardDAV base URL is:

  ```
  https://<nas-ip>:<https-port>/carddav/    # e.g. https://192.168.50.3:5001/carddav/
  ```

- DSM's HTTPS cert is self-signed, so enable **Allow self-signed certificates** (see the note above).

### Nextcloud — one base URL for both

Nextcloud auto-discovers calendars **and** contacts from a single DAV base, so put the **same URL** in
both the Server URL and CardDAV URL fields:

```
https://<your-nextcloud-host>/remote.php/dav/
```

(In-app you can also copy the exact addresses: **Calendar → Settings, bottom-left → "Copy primary CalDAV
address"**; contacts live under `/remote.php/dav/addressbooks/users/<user>/`.)

### Other servers

Most CalDAV/CardDAV servers auto-discover from a base URL — paste that and the app finds the collections:

- **Baïkal:** `https://<host>/dav.php/` (discovers both calendars and address books).
- **Radicale:** `http://<host>:5232/` (or `http://<host>:5232/<user>/`).
- **Generic / DAVx5-compatible:** if a single base URL doesn't discover everything, enter the specific
  collection URLs — `.../calendars/<user>/` for CalDAV and `.../addressbooks/<user>/` for CardDAV.

Notes: usernames with spaces can break discovery on some servers — avoid them if possible. Synology
doesn't support two-factor auth for third-party CalDAV/CardDAV clients; use your normal password.

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
- Calendar view: month/week/day views showing tasks and events together, with a tasks/events/both
  toggle, task display modes (due date, start date, or start→due range), and list/category filters.
  Double-click or right-click a day or time slot to create an item there; drag a bar to reschedule it
  (drag an edge to resize)
- Calendar events: create/edit/delete events, including recurring events (whole-series) via the same
  RRULE presets tasks use — all synced two-way over CalDAV
- Reminders & notifications: multiple reminders per task/event (at time, or minutes/hours/days before),
  native desktop notifications that jump to the item when clicked, synced as CalDAV VALARMs so Android
  clients (DAVx5 + Etar, Tasks.org mobile) can fire them too
- Collapsible sidebar and right rail (with re-expand tabs) to give the calendar/list more room
- Search across title/notes/tags, right-click context menu (complete/duplicate/delete), keyboard
  shortcuts (Ctrl+N new task, Ctrl+Shift+N new list, Ctrl+F search, Ctrl+R sync, N new task, Delete to
  remove the selected task) — fully mouse/keyboard driven, no touch gestures anywhere
- CalDAV accounts screen: add a server (label, URL, username, password/app-token), test the connection,
  discover its calendars, and link any local list to a remote calendar
- Two-way sync engine (`electron/caldav.ts`): pulls new/changed remote VTODOs/VEVENTs into the local DB,
  pushes new/changed local tasks and events to the server, and propagates local deletions

## Known limitations / next steps
- Sync conflicts (same task edited on two devices between syncs) keep the server version on the synced
  task and preserve the local edits as a "(conflicted copy)" task; there's no merge UI yet.
- Only one level of subtasks is modeled (no infinitely nested subtasks).
- Recurring events are edited as a whole series only (no per-occurrence exceptions), and the calendar
  grid draws a recurring event on its first occurrence rather than expanding it across every date; the
  RRULE itself is stored and synced correctly.
