# Notes for next session

Written 2026-07-03, end of session.

## UI fixes requested

- "Show scheduled" toggle and "Save view" button in the toolbar-filters row are positioned awkwardly — rework their placement/layout (src/App.tsx toolbar-filters section, styles in src/styles.css).
- Clearing the date should also clear the time (added 2026-07-04).
- ~~Opening the app should trigger a sync; hitting save should trigger a sync~~ — done 2026-07-09 on `experimental` branch, see below.
- Typing in the search field brings the app to a crawl — investigate performance (likely needs debouncing/memoization) (added 2026-07-04).
- App has gotten super slow in general — overall performance investigation needed (added 2026-07-04).

## Sync-on-open / sync-on-save (2026-07-09, `experimental` branch)

Ported Tasks.org's (Android) sync-triggering methodology into src/App.tsx, researched from the
tasks/tasks GitHub source (WorkManagerImpl.kt, SyncAdapters.kt, SyncSource.kt, Debouncer.kt):

- **Sync on launch**: one-shot `setTimeout` ~1.5s after mount calls `runSync(true)`, mirroring
  Tasks.org's app-open sync. (Tasks.org also resumes its hourly WorkManager job across boots
  automatically — no direct equivalent needed here since this app has no separate "boot" moment;
  "launch at login" already gets covered by the same on-launch trigger.)
- **Sync after edits**: new `scheduleDirtySync()` (60s debounce, timer resets on every call) is
  invoked after task create/update/toggle-complete/delete/duplicate/subtask/snooze. Mirrors
  Tasks.org's dirty-row watcher + 1-minute debounced sync (SyncSource.TASK_CHANGE). Deliberately
  *not* called from `reorderTask` — sort_order is local-only and already excluded from the dirty/
  sync path (see comment on that function).
- **Periodic interval**: this app already had a user-configurable background-sync timer
  (`syncIntervalMinutes`, "0" = manual only), the desktop analogue of Tasks.org's fixed 1-hour
  `PeriodicWorkRequest`. Default bumped from 5 min to 60 min to match Tasks.org, since sync-on-save
  and sync-on-launch now cover the cases that mattered most about a short interval; added a
  "60 minutes (Tasks.org default)" option to the Settings dropdown. Only affects new/unconfigured
  installs — existing users with a stored `syncIntervalMinutes` value are unaffected.
- **Not ported**: Tasks.org's `APP_RESUME` (re-sync if foregrounded and last sync >5 min ago) —
  skipped since this app doesn't really "background/foreground" the way a phone app does with
  the tray icon. Easy to add later if it turns out to matter.

Not yet done: this was implemented and reviewed in the Cowork sandbox but **not built or
committed from there** (per the standing rule below). Needs a `npm run build`/typecheck and a
manual smoke test (create a task, edit+save a task, confirm a sync fires ~1 min later; check
the interval timer still runs) from a real terminal before committing on `experimental`.

## Status 2026-07-04 (Linux session)

- v0.1.14 installed on the Linux machine via update-tasksdesktop.sh (script now at ~/.local/bin/update-tasksdesktop); launches cleanly.

## Backlog

- **Flatpak repo auto-updates** (decided 2026-07-04, deferred until current build is tested for a while):
  self-host an OSTree repo on GitHub Pages via the Flatter GitHub Action (GPG-signed, prune old builds),
  and build bundles with `--repo-url` embedded so installing a release bundle auto-registers the remote —
  then `flatpak update` / GNOME Software handles updates like Flathub apps. Replaces the update script.
- Optional smaller step: in-app "update available" check on Linux against GitHub releases/latest
  (IPC plumbing `update:status` already exists).

## Release notes process (new as of 2026-07-04)

- RELEASE_NOTES.md at repo root is published as the GitHub release body by CI (`body_path` in build.yml).
- Keep it updated as changes land; it always describes the *next* release. Reset it after each tag.

## Session context

- v0.1.13 tagged this session: About dialog (View → About Tasks Desktop), Edit → Settings…, date/time inputs stacked vertically + dark themed (added `color-scheme: dark` and `input[type="time"]` to the dark input rule).
- User runs 0.1.12 installed on Win11; auto-update works from 0.1.9+. v0.1.13 release publishes via CI on tag push.
- Old tags v0.1.10/v0.1.11 exist locally but were deliberately NOT pushed — never `git push --tags` (stale releases would hijack "latest" and break auto-update).
- IMPORTANT: the Cowork sandbox mount can show truncated file tails for recently edited files (caused corrupted commits before v0.1.8). Never commit/build from the sandbox — verify with the file tools (Windows side) and let the user commit from their own terminal.
