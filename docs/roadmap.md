# Roadmap / ideas to circle back to

## Next up
- **Recurring event editing, part 2 — per-occurrence edits** (RRULE picker + whole-series
  create/edit/delete shipped 2026-07-09, see "Recurring event editing" under DONE below). Still
  needed: the single-occurrence-vs-whole-series prompt ("This event" / "This and following" /
  "All events") that Thunderbird/Outlook/Google Calendar all surface, which needs RECURRENCE-ID
  exception VEVENTs. Also, the calendar grid still only shows a recurring event's first
  occurrence — no RRULE expansion yet (`CalendarView.tsx`'s `buildEcEvents` doesn't do occurrence
  math), so a weekly/daily event doesn't visually repeat across the grid even though the RRULE is
  stored and synced correctly. **Pick this up first thing next session.**
- **Drag-to-reschedule doesn't persist** (found 2026-07-09): dragging an event to a new day/time
  on the calendar doesn't update its stored start/end — it either snaps back or just visually
  moves without saving. Root cause: `CalendarView.tsx` never sets `editable: true` or wires an
  `eventDrop`/`eventResize` callback on the `createCalendar` options, so nothing persists the
  drop back to `onUpdate`/CalDAV. Needs an `eventDrop(info)` handler that computes the new
  start/end from `info.event.start`/`.end` and calls the same `onUpdate` path the detail panel
  uses (plus the same treatment for task bars, which have their own drag semantics since they're
  rendered as all-day date ranges, not real events).
- **Android VALARM notifications still not firing** (retested 2026-07-09 with the zero-duration
  event fixed/on the correct calendar — still didn't arrive). Cause still unconfirmed; user is
  going to set up a second Android device to help isolate whether this is phone-specific (the
  primary test device already has a history of unreliable notifications from other calendar apps)
  versus something about Tasks Desktop's sync/VALARM output. **Test with the second phone first
  thing next session.**
- **Collapsible/resizable right rail** (added 2026-07-09, user said this can wait if it's a big
  lift): let the Today pane + task/event detail column collapse or resize so the calendar grid
  can use the freed width. `.app`'s grid-template-columns is currently fixed (`220px 1fr 320px`
  in styles.css) — would need a collapsed-width state, a toggle button, and the grid template to
  react to it.
- **Per-category colors** (added 2026-07-09): Thunderbird supports assigning a color to each
  category, independent of the calendar/list it's on. Tasks.org doesn't have this. Calendar view
  currently colors tasks/events by their list only (categories have no color anywhere in the app —
  they're free-text comma-separated tags with no color storage). Worth adding: a `categories` table
  (name, color) + small settings UI, then calendar/task-table coloring could prefer category color
  over list color when a task has one. Deferred for now — calendar view v1 uses list color only.

## Event editing — DONE (2026-07-09)
- Calendar events were a read-only mirror (`EventDetailPanel.tsx` explicitly said so). Shipped
  create/edit/delete for non-recurring events: `eventToVEvent` in `electron/ical.ts` (mirroring
  `taskToVTodo`), a push phase in `caldav.ts` mirroring the task etag/dirty/conflict logic,
  `dirty` column + CRUD in `db.ts`, IPC in main.ts/preload.cts, and an editable form in
  `EventDetailPanel.tsx`.

## Recurring event editing, part 1 — whole-series CRUD — DONE (2026-07-09)
- Per explicit user request ("we are going to want to add recurring events, put it on the game
  plan"): events with an RRULE can now be created and edited, not just read-only. Added the same
  `RECUR_PRESETS` dropdown (Daily/Weekly/Monthly/Yearly/custom RRULE) tasks already had to
  `EventDetailPanel.tsx`, removed its read-only branch for recurring events, and dropped the
  `if (local.recurrence) continue` skip in `caldav.ts`'s event push loop. Scoped deliberately as
  **whole-series only** — every edit rewrites the single master VEVENT's RRULE, no RECURRENCE-ID
  exceptions — to avoid the bigger occurrence-vs-series lift for this first pass. See "part 2"
  above for the follow-up (per-occurrence edits + grid expansion).

## Calendar view — week/day views, time-slot creation, view toggle — DONE (2026-07-09)
- Month/Week/Day toggle in the calendar toolbar (styled as a `due-filter-select` like the other
  toolbar filters), replacing the library's default dead-feeling "today" header button. Week/Day
  use `@event-calendar/core`'s `TimeGrid` plugin (`timeGridWeek`/`timeGridDay`) for an hourly grid
  with a scrollbar and a current-time indicator line, not `DayGrid`'s `dayGridWeek` (which is just
  a strip of day cells with no hours).
- `slotEventOverlap: false` so same-time events lay out side by side in their own columns instead
  of stacking with a slight offset — the stacked ones underneath were hard to click. User flagged
  this still doesn't feel fully right after the change (2026-07-09) — revisit if it comes up again,
  wasn't pinned down further this session.
- Double-click or right-click on a time slot in week/day view now fills in the actual clicked time
  (via `dateFromPoint`'s `allDay: false` case) instead of only ever creating an all-day item;
  month view still only carries the date. New events/tasks created with a start time — from a
  calendar click or typed manually in the detail panel — default their end/due to a 1-hour span if
  it's still blank, editable after (`addOneHour` helper in both `EventDetailPanel.tsx` and
  `DetailPanel.tsx`).

- **Interop note, still relevant**: before doing more calendar-view work, look at **Rainlendar** —
  a lot of Tasks.org users run it as their desktop calendar, and (Pro version) it speaks CalDAV
  directly against the same calendars this app syncs with, which might cover some of this for free.

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
- **Shipped local-only first** (v1, informed by research): not synced via CalDAV VALARM at
  first. Both Thunderbird and Tasks.org have real VALARM-sync pain (Thunderbird: buggy
  recurring-event dismiss/snooze; Tasks.org: explicitly skips VALARM sync for some CalDAV
  servers, including Synology — which this user's own "Cal Synology" list runs on).
- **Recurring events excluded, still true**: they only show their first occurrence today (no
  RRULE expansion), so a reminder anchored to that would fire wrong. `ensureDefaultReminder`
  skips recurring events on create, `remindersDueForNotification` skips them defensively too,
  and the VALARM push/pull below also skips them.
- A default "at time of" reminder auto-applies on task/event creation (when a due/start date
  is present) and on the specific null→non-null due/start-date transition on edit — but never
  unconditionally on every edit, so deleting the default reminder sticks.

## CalDAV VALARM sync for reminders — DONE (2026-07-09, same day as local-only v1)
- Per explicit user request ("I do want reminders from this app to work in android with stock
  calendar/Etar... going to need to implement it pretty soon, even if it has bugs"), reminders
  now round-trip as VALARM sub-components so Android CalDAV clients (DAVx5 + Etar, Tasks.org
  mobile, etc.) can see and fire them too.
- `electron/ical.ts`: `taskToVTodo`/`eventToVEvent` take an optional `reminderOffsets: number[]`
  and emit one VALARM per offset (`ACTION:DISPLAY`, `TRIGGER` as `ICAL.Duration.fromSeconds
  (-minutes*60)`); tasks set `RELATED=END` on the trigger since VTODO's default trigger
  relation is DTSTART but this app's reminders are always due-date-anchored, events need no
  param since START already matches `start_date`. `parseVTodo`/`parseVEvent` read VALARM
  triggers back into a `reminderOffsets: number[]` field (only zero/negative relative-duration
  triggers count as "before"; absolute date-time triggers and positive "after" triggers are
  ignored, out of scope for this app's model).
- `electron/db.ts`: `mergeRemindersFromRemote(ownerType, ownerId, offsets)` is **additive
  only** — adds offsets present on the server but missing locally, never removes anything, and
  is a complete no-op when `offsets` is empty. This matters because the user's own Synology
  CalDAV server is known to strip VALARM entirely; a naive replace-on-pull would otherwise wipe
  every local reminder on every sync. `reminderCreateForOwner`/`reminderDeleteForOwner` wrap the
  raw CRUD and additionally mark the owning task/event `dirty: 1` so a reminder-only change gets
  pushed next sync; the raw functions stay dirty-free for `ensureDefaultReminder` and the
  remote-merge path (avoids a re-push loop). `main.ts`'s `reminders:create`/`reminders:delete`
  IPC handlers now call the `*ForOwner` versions.
- `electron/caldav.ts`: push (both create and update paths, tasks and events) fetches
  `remindersForOwner(...)` and passes the offsets into the serializers. Pull calls
  `mergeRemindersFromRemote` after a successful create, etag-only catchup, or conflict/overwrite
  branch — recurring items are skipped throughout, consistent with the reminders-excluded-from-
  recurring decision above. "(conflicted copy)" tasks/events also carry over the pre-conflict
  local reminder offsets (via the same additive merge), so a reminder configured locally isn't
  silently dropped when a conflict copy is created.
- **Verified working end to end (2026-07-09)**: push tested Tasks Desktop → Thunderbird (VALARM
  arrived, notification fired in both apps) and pull tested Thunderbird → Tasks Desktop (same).
- **Android result is mixed, cause still unconfirmed after two rounds of testing**: a reminder
  pushed from Thunderbird fired correctly on the user's Android device, but one pushed from Tasks
  Desktop to the same calendar did not.
  - Round 1 (2026-07-09): compared the raw VALARM-DEBUG dumps in `sync.log` for a Tasks-Desktop-
    pushed test event vs. Thunderbird's — found the Tasks Desktop test event had `DTSTART` equal
    to `DTEND` (zero duration) and a `TRIGGER:PT0S` (fires at start, no lead time) default from
    `ensureDefaultReminder`, vs. Thunderbird's non-zero-duration events with `-PT5M`+ lead. Theory:
    a 0-minute-lead reminder can already be in the past by the time DAVx5's sync interval delivers
    it to the phone, and Android silently drops past-due alarms rather than firing them late.
  - Round 2 (2026-07-09, same session): retested with a fresh event given a 10-15 minute reminder
    lead — but it turned out to be created on the wrong calendar the first attempt, so that retest
    doesn't count. After fixing the calendar and retesting again, the reminder still didn't arrive
    on Android.
  - Not proven either way yet whether this is a Tasks Desktop/sync issue or a phone-side issue —
    the primary test device is a "unique" Android build that has already shown unreliable
    notifications from other calendar apps. **Next session: test with a second Android device**
    (user is setting one up) to isolate phone-specific flakiness from an actual app bug.

## Calendar month-view time badge showing wrong hour — FIXED (2026-07-09, same session)
- While testing VALARM above, found a real event/reminder time (e.g. 4:41 PM) displaying as
  8:41 PM in the calendar month-grid's little time badge, while the Details panel and the
  reminder notification both showed the correct time. Root cause: `@event-calendar/core`'s
  built-in time-badge text (driven by its `eventTimeFormat` option/internal `Intl` formatting)
  comes out wrong for the day-grid month view specifically — off by exactly the local UTC
  offset — even with a correctly-converted input value and an explicit `timeZone: "UTC"`
  override on `eventTimeFormat` (confirmed via a live debug log that the value handed to the
  library was already correct, and via a DevTools console check that plain `Intl` formatting
  works fine in this environment, so the bug is internal to that one library code path, not our
  data or the browser's `Intl` support). Rather than keep chasing that internal path, fixed in
  `CalendarView.tsx` by bypassing it: events are handed to the calendar as floating (no
  "Z"/offset) local datetime strings via a new `toLocalFloating()` helper (so the library's own
  timezone-shift math never touches them), and a custom `eventContent` callback renders the
  time badge itself from `arg.event.start` — which the library exposes as an already
  correctly-converted local `Date` via its own `toLocalDate()` helper — using a plain
  `toLocaleTimeString()`, sidestepping the broken formatter entirely. All-day "YYYY-MM-DD"
  values are unaffected (no time-of-day component to get wrong, and `eventContent` returns
  `undefined` for them so the library's normal title-only rendering still applies).

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
