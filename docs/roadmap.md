# Roadmap / ideas to circle back to

## Next up
- **Collapsible/resizable right rail** (added 2026-07-09, user said this can wait if it's a big
  lift): let the Today pane + task/event detail column collapse or resize so the calendar grid
  can use the freed width. `.app`'s grid-template-columns is currently fixed (`220px 1fr 320px`
  in styles.css) — would need a collapsed-width state, a toggle button, and the grid template to
  react to it.
- **Event editing** (added 2026-07-09, IN PROGRESS as of 2026-07-09 later session): calendar events
  were a read-only mirror (`EventDetailPanel.tsx` explicitly said so). Now building create/edit/delete
  for non-recurring events: `eventToVEvent` in `electron/ical.ts` (mirroring `taskToVTodo`), a push
  phase in `caldav.ts` mirroring the task etag/dirty/conflict logic, `dirty` column + CRUD in `db.ts`,
  IPC in main.ts/preload.cts, and an editable form in `EventDetailPanel.tsx`. Recurring events (has an
  RRULE) stay read-only in this pass — see "Recurring event editing" below for the follow-up.
- **Recurring event editing** (added 2026-07-09, per explicit user request — "we are going to want to
  add recurring events, put it on the game plan"): once non-recurring event CRUD ships, extend it to
  events with an RRULE. Needs the same single-occurrence-vs-whole-series decision Thunderbird/Outlook/
  Google Calendar all surface as a prompt ("This event" / "This and following" / "All events") —
  requires either RECURRENCE-ID exception VEVENTs (edit one occurrence) or rewriting the RRULE (edit
  the series). Also needs UI for *creating* a new recurring event (recurrence-rule picker), which
  doesn't exist anywhere in the app yet even for tasks' RRULE support. Bigger lift than plain CRUD —
  do this only after non-recurring editing has been tested and feels solid.
- **Per-category colors** (added 2026-07-09): Thunderbird supports assigning a color to each
  category, independent of the calendar/list it's on. Tasks.org doesn't have this. Calendar view
  currently colors tasks/events by their list only (categories have no color anywhere in the app —
  they're free-text comma-separated tags with no color storage). Worth adding: a `categories` table
  (name, color) + small settings UI, then calendar/task-table coloring could prefer category color
  over list color when a task has one. Deferred for now — calendar view v1 uses list color only.

- **Calendar view** — circle back to this after the recurrence + hide-until work ships.
  Before designing it, look at **Rainlendar**: a lot of Tasks.org users run it as their
  desktop calendar. Worth checking (a) what its task/event UI gets right, and (b) whether
  we can interoperate directly — Rainlendar can read iCalendar files and (in the Pro
  version) speak CalDAV, so it may be able to point at the same CalDAV calendars this app
  syncs with, giving users a desktop calendar overlay for free without us building one.

## Reminders / notifications — DONE (v0.1.12)
- Shipped: minute-tick scheduler in the main process, native notifications (click
  focuses the task), date-only tasks fire at a configurable time (default 18:00),
  tray icon with close-to-tray, launch at login. Later: snooze buttons ON the
  notification itself, repeating nags for overdue tasks.

## Multiple configurable reminders, for tasks AND events — DONE (2026-07-09)
- Shipped, per explicit user spec ("multiple reminders and pick at time of, or how many
  minutes or hours or days before"): a `reminders` table (`owner_type, owner_id,
  offset_minutes, fired_at`), CRUD + `ensureDefaultReminder`/`remindersDueForNotification`
  in `db.ts`, `checkReminders()` in `main.ts` rewritten to use it (fires for both tasks
  and non-recurring events, clicking a notification jumps to the right view/item via
  `notify:select-task`/`notify:select-event`), IPC in `preload.cts`/`types.ts`, and a
  shared `RemindersEditor.tsx` component wired into both `DetailPanel.tsx` and
  `EventDetailPanel.tsx` (chips + add-reminder control).
- **Local-only for v1** (explicit decision, informed by research): not synced via CalDAV
  VALARM. Both Thunderbird and Tasks.org have real VALARM-sync pain (Thunderbird: buggy
  recurring-event dismiss/snooze; Tasks.org: explicitly skips VALARM sync for some CalDAV
  servers, including Synology — which this user's own "Cal Synology" list runs on). Revisit
  VALARM round-tripping later if it becomes worth the complexity.
- **Recurring events excluded from v1** (explicit user decision): unchanged from the original
  plan above — they only show their first occurrence today (no RRULE expansion), so a
  reminder anchored to that would fire wrong. `ensureDefaultReminder` skips recurring events
  on create, and `remindersDueForNotification` skips them defensively too.
- A default "at time of" reminder auto-applies on task/event creation (when a due/start date
  is present) and on the specific null→non-null due/start-date transition on edit — but never
  unconditionally on every edit, so deleting the default reminder sticks.

## Lighter runtime than Electron
- Revisit the earlier discussion about moving off Electron to something lighter.
  Leading candidate: **Tauri** (Rust core + the OS's own webview) — installers drop from
  ~100 MB to ~10 MB and idle RAM drops similarly. Alternatives: **Wails** (Go) or
  **Neutralino**. The React renderer ports mostly as-is; the work is in the main-process
  side: `electron/db.ts` (node:sqlite), `electron/caldav.ts` (tsdav), and the IPC bridge
  would need Rust equivalents (rusqlite is easy; CalDAV client is the real effort) or a
  Node sidecar process as a halfway step. Auto-update also needs redoing (Tauri has its
  own updater). Best tackled after the feature set stabilizes, since it's a rewrite of
  the whole non-UI layer.

## Contacts / CardDAV
- Add a contacts pane backed by **CardDAV** (same servers: Nextcloud, Tasks.org-compatible
  hosts, DAVx5 ecosystem). tsdav already speaks CardDAV, so discovery/auth/sync reuse the
  existing account plumbing; needs a vCard parser (ical.js handles vCard too), a contacts
  table + dirty-flag sync like tasks, and UI. Also opens the door to assigning contacts
  to tasks later.

## Bundled CalDAV server ("self-contained" variant) — THE headline goal
- Product vision: a plug-and-play replacement for Google/Apple/Microsoft
  calendar-tasks-contacts for people with NO self-hosting experience, on the computer
  they already own. One installer, minimal setup, phone syncs to your own PC. The
  differentiator isn't the server itself — it's the setup experience: install, the app
  handles the firewall rule, generates the sync account, and shows a QR code / short URL
  that configures DAVx5//Tasks.org on the phone. A tray icon shows "phone last synced
  N minutes ago". Combined with Contacts/CardDAV (above), that covers tasks + calendar +
  contacts — the core of what keeps people on big-tech accounts.
- Candidates: **Radicale** (Python, tiny, easiest to embed), **Baïkal** (PHP, heavier),
  **xandikos** (Python, pure-Git storage). Radicale is the obvious first pick; an
  alternative is implementing a minimal CalDAV subset (PROPFIND/REPORT/PUT/DELETE on
  VTODOs) directly in the Electron main process, since we already have tsdav + ical.js.
- Intermittent availability is a NON-issue: CalDAV clients (DAVx5, Tasks.org) queue
  local changes and simply retry when the server is reachable again — same pattern as a
  NAS that sleeps overnight. A desktop set to launch on boot is plenty. The embedded
  server is therefore viable as-is; what it actually needs is plumbing:
  - stable LAN address for the phone to target (DHCP reservation or hostname)
  - Windows Firewall / firewalld inbound rule for the chosen port (installer or
    first-run prompt should handle this)
  - auth (Radicale htpasswd or equivalent) and optionally a self-signed cert; DAVx5
    accepts plain HTTP on LAN with a warning
  - launch-on-boot + close-to-tray so quitting the window doesn't kill the server
- **Docker deployment** (deprioritized): the docker-literate audience already has
  Nextcloud/Radicale/Baïkal images; a compose file for our server variant is a
  nice-to-have later, not a differentiator. The standalone embedded version comes first.

## Smaller items
- ~~Manual drag-to-reorder~~ DONE (v0.1.11)
- ~~Saved filters / smart lists~~ DONE (v0.1.11)
- ~~Right-click snooze~~ DONE (v0.1.11); snooze buttons on notifications still open
