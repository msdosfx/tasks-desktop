# Handoff: rename flatpak appId arlis → precisioncrab

Written 2026-07-13. Purpose: hand this task to a fresh chat on another (Linux) computer.
Read together with `docs/linux-handoff.md`.

## The goal

Change the app's flatpak/electron application ID from **`com.arlis.tasksdesktop`** to
**`com.precisioncrab.tasksdesktop`** (adjust the exact string if a different ID is
preferred — this is the only decision to confirm before starting).

## Why it still says "arlis" (context)

The GitHub account was renamed **arlis/msdosfx → precisioncrab**. Commit `d71f364`
("Point publish owner, README links, and update helper at renamed account") updated the
*publish owner* and *links* — but the **appId is a separate thing** from the GitHub account,
so it was never changed. The running flatpak therefore still reports `com.arlis.tasksdesktop`.

`flatpak run com.arlis.tasksdesktop` currently works and syncs fine. The only reason to
change the ID is cosmetic/branding consistency with the precisioncrab account.

## Source of truth

`package.json` → `build.appId` is the value electron-builder bakes into the flatpak. The
flatpak-repo CI workflow *derives* its APPID from the exported OSTree ref, so once
`package.json` changes and a new build runs, the workflow, `.flatpakref`, and desktop file
follow automatically. Everything else in the list below is either a second hardcoded copy or
human-facing docs/scripts.

## Files to change

Required (functional):

- `package.json` line ~42 — `"appId": "com.arlis.tasksdesktop"` → `com.precisioncrab.tasksdesktop`
- `electron/main.ts` line ~376 — `app.setAppUserModelId("com.arlis.tasksdesktop")` (Windows toast ID) → new ID

Human-facing references (update so instructions match reality):

- `README.md` (lines ~49, ~58) — `flatpak run` / `flatpak uninstall` commands
- `docs/linux-handoff.md` (lines ~47, ~68) — app-id note and verify step
- `scripts/update-tasksdesktop.sh` line ~12 — `flatpak info com.arlis.tasksdesktop`
- root-sibling `update-tasksdesktop.sh` (the copy outside the repo, if still used) — same line

Optional / separate namespaces (decide whether to also rebrand):

- Thunderbird addon id `tasks-desktop@arlis` in `thunderbird-addon/manifest.json` and
  `dist-addon/manifest.json`, plus `author: "Arlis"` — this is the addon's own ID, unrelated
  to the flatpak. Leave unless you also want to rebrand the addon.

Do NOT bother editing (regenerated build artifacts):

- `release/builder-effective-config.yaml` — regenerated on next `electron-builder` run
- `release/win-unpacked/resources/app-update.yml` — stale artifact (still says `owner: msdosfx`)

## Migration consequences (important)

Changing the appId makes flatpak treat it as a **brand-new app**:

- The installed `com.arlis.tasksdesktop` will **not** upgrade into the new ID. You install the
  new one fresh, then remove the old one:
  ```
  sudo flatpak uninstall com.arlis.tasksdesktop
  ```
- App data lives at `~/.var/app/com.arlis.tasksdesktop/`. The new ID starts with an **empty**
  data dir. To carry over the local task DB / CalDAV settings, copy before removing the old app:
  ```
  cp -a ~/.var/app/com.arlis.tasksdesktop/ ~/.var/app/com.precisioncrab.tasksdesktop/
  ```
  (Do this while the app is closed. Verify sync still works, then uninstall the old ID.)
- Note the current install is **system-wide** (installed with `sudo flatpak install`), so
  uninstall needs `sudo` too.

## Suggested steps on the Linux machine

1. `git pull` and confirm you're on latest `main` (see `git log --oneline -1`).
2. Confirm the target ID string (default assumed: `com.precisioncrab.tasksdesktop`).
3. Edit the two functional files + the human-facing docs/scripts above.
4. `npm run build` then `npm run package` (electron-builder) to produce a new `.flatpak` with
   the new ID; or push a tagged release and let CI build it.
5. Install new, migrate data dir if wanted, then `sudo flatpak uninstall com.arlis.tasksdesktop`.
6. Verify: `flatpak info com.precisioncrab.tasksdesktop` and `flatpak run com.precisioncrab.tasksdesktop`.
7. Commit: e.g. "Rename appId com.arlis → com.precisioncrab.tasksdesktop".

## Not-actually-errors (from the last install, for reference)

The install log looked scary but the app installed and synced fine. These are benign flatpak
sandbox warnings, not failures:

- `Failed to connect to .../system_bus_socket` — Electron reaching for the system D-Bus;
  sandbox only exposes the session bus, Electron falls back. Cosmetic.
- `Failed to load module "xapp-gtk3-module" / "canberra-gtk-module"` — host `GTK_MODULES`
  leaks in module names not present in the flatpak runtime; GTK skips them. Only effect: no
  GTK event sounds.
- `Running in confined mode, using Portal notifications` — expected & correct; notifications
  route through the desktop portal (manifest already grants `org.freedesktop.Notifications`).

## Additional backlog items (from Arlis, 2026-07-13)

### 1. Bug — overdue tasks not showing in the Today pane (flatpak build)

The shipped flatpak isn't listing overdue tasks in the Today pane. Note that the **current
source already implements this**: `src/components/TodayPane.tsx` has `isDueByToday()`
(true for any due date `<= today`) and builds an `overdue` label (lines ~30-33, ~78-83):

```
if (!isDueByToday(t.due_date, today) && !isToday(t.start_date, today)) continue;
const overdue = !due && isDueByToday(t.due_date, today);   // label: "overdue" / "starts & overdue"
```

So the most likely cause is a **stale flatpak** (installed build predates this code) — rebuild
+ reinstall and re-check first. If it's still missing after a fresh build, the bug is upstream
of the pane: check what `tasks` array `App.tsx` passes into `<TodayPane>` (around
`src/App.tsx`) — confirm overdue/incomplete tasks aren't filtered out (e.g. a completed filter
or a "due == today exactly" filter) before they reach the pane. Also compare against the other
panes / the experimental build, per Arlis: verify the same `isDueByToday` cutoff logic is used
consistently (TaskTable / list views) so "overdue" means the same thing everywhere.

### 2. Feature — Ctrl+ / Ctrl- to zoom the interface

Want keyboard zoom (Ctrl-plus / Ctrl-minus, and Ctrl-0 to reset) to scale the whole UI for
high-DPI or small screens. No zoom handling exists today. Cleanest path in Electron: add
zoom items to the app menu in `electron/main.ts` (it already builds a Menu with accelerators,
e.g. lines ~200-243). Options:

- Use the built-in menu roles `zoomIn` / `zoomOut` / `resetZoom` (simplest), or
- Drive `mainWindow.webContents.setZoomFactor()` / `setZoomLevel()` manually so the value can
  be persisted.

### 3. Feature — persisted interface-size setting

Alongside the hotkey, expose a size/zoom control in Settings so the choice sticks across
restarts. Follow the existing prefs pattern: prefs are defined in `electron/main.ts` (see the
`syncHotkey` default around line ~52) and edited in `src/components/SettingsModal.tsx` (which
already has a hotkey dropdown, lines ~374-379). Add a zoom-factor pref (e.g. 0.8-2.0 slider or
dropdown), apply it on load via `setZoomFactor`, and keep it in sync with whatever the Ctrl+/-
handler sets so both routes agree.

## Sandbox rule (carried over)

Never `git push` or build from the Cowork sandbox (no GitHub network access; historical file
truncation issue). Do pushes/builds from a normal terminal, and re-verify file tails after any
sandbox edits.
