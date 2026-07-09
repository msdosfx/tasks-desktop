# Roadmap / ideas to circle back to

## Next up
- **Multiple configurable reminders, for tasks AND events** (added 2026-07-09, per explicit user
  spec): "you should be able to pick a reminder, and multiple reminders and pick at time of, or how
  many minutes or hours or days before." This is real VALARM support (iCalendar's alarm
  sub-component) — a task or event can have several reminders, each independently either "at time
  of" or an offset (N minutes/hours/days before). Current reminder system (`electron/main.ts`
  `checkReminders()`, `tasksDueForNotification`/`taskMarkNotified` in `db.ts`) is a single global
  `reminderTime` setting used only for date-only tasks, with a `notified_at` single-timestamp guard
  — not enough structure for multiple independent reminders per item. Real scope:
  - New `reminders` table: `id, owner_type ('task'|'event'), owner_id, offset_minutes (0 = at time
    of, negative = before), fired_at (nullable, replaces the single notified_at column)`.
  - UI: an "Add reminder" control in both `DetailPanel.tsx` and `EventDetailPanel.tsx`, listing
    each reminder as a chip/row with a value+unit picker (minutes/hours/days) or "At time of", and a
    remove button.
  - Since VALARM is standard iCalendar, reminders could round-trip via CalDAV (embedded in the
    VTODO/VEVENT's VALARM blocks in `taskToVTodo`/`eventToVEvent`/`parseVTodo`/`parseVEvent`) rather
    than staying purely local-only — worth doing if feasible, since it'd make reminders survive
    re-syncing from another client and show up in e.g. DAVx5/Tasks.org too. Needs research into
    `ical.js`'s VALARM support.
  - Scheduler rewrite: `checkReminders()` needs to check the new `reminders` table against both
    tasks' due_date and events' start_date instead of the current tasks-only, single-timestamp logic.
  - **Recurring events are excluded from this v1** (explicit user decision): they only show their
    first occurrence on the calendar today (no RRULE expansion yet, see "Recurring event editing"
    below), so a reminder based on that stale first-occurrence date would fire wrong or not at all.
    Non-recurring events and all tasks (recurring tasks already advance their due_date correctly via
    `nextOccurrence` in `taskToggleComplete`) are in scope.
  - Bigger lift than a quick add — plan and build this as its own pass, likely after the current
    event-editing work is committed and tested.
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
