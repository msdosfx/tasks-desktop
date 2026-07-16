# Roadmap / ideas to circle back to

## Next up
- **Recurring event editing, part 2 — per-occurrence edits** (RRULE picker + whole-series
  create/edit/delete shipped 2026-07-09, see "Recurring event editing" under DONE below). Still
  possible if wanted later: the single-occurrence-vs-whole-series prompt ("This event" / "This and
  following" / "All events") that Thunderbird/Outlook/Google Calendar all surface, which needs
  RECURRENCE-ID exception VEVENTs.
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

## RRULE grid expansion — DONE (2026-07-11)
- **Reversed the 2026-07-10 "decided against" call** at the user's request: not being able to see a
  recurring item anywhere but its original date was a real problem (a weekly task set up months ago
  showed only on its base date, invisible in the current month). Went with the **Thunderbird model**
  (expand the series across the visible grid) over the Tasks.org model (one rolling instance that
  advances on completion), since a calendar's whole job is spreading occurrences out.
- `CalendarView.tsx` now expands each recurring event/task across the currently-visible range:
  a new `occurrenceDeltas()` helper runs the stored RRULE through `rrule.js` (already a dep, same
  lib as `db.ts`) and returns occurrence offsets as **ms deltas from the anchor**, so each drawn
  bar reuses the existing `shiftStored()` format/timezone-safe path instead of re-deriving dates.
  Tasks anchor on the due date (matching `db.ts`'s completion roll-forward) and honor all three
  display modes; events anchor on start and carry their duration.
- Visible range is tracked via the calendar's `datesSet` callback (stashed in a ref + a
  `rangeVersion` bump that re-triggers the event rebuild), so occurrences appear wherever the user
  navigates, not just the mount month. Expansion window is padded ±2 days so an occurrence at the
  grid edge isn't clipped by rrule/window timezone rounding.
- Occurrences are **read-only "ghosts"**: `editable: false` (the existing drag guards still revert
  as a backstop), dimmed with a dashed outline + faint diagonal hatch + a ↻ marker (`.ec-recurring`
  / `.ec-recur-mark` in styles.css). Clicking one opens the **master** item's detail panel — the
  occurrence id gets an `::<n>` suffix for uniqueness, and `eventClick` resolves the real id from a
  `masterId` stashed in `extendedProps`. The base (non-recurring) bars keep their plain
  `task-`/`event-` ids so the editable drag path is untouched.
- Verified with `tsc --noEmit` (clean). Full `vite` build still can't run in the Linux sandbox
  (rollup's native binary is Windows-only) — run `npm run build` on Windows to confirm the bundle.
- Follow-up still open: per-occurrence *editing* (drag/delete a single instance) needs
  RECURRENCE-ID/EXDATE exceptions — see "Recurring event editing, part 2" under Next up. This
  change is display-only; the master RRULE and CalDAV round-trip are unchanged.

## Drag-to-reschedule — DONE (2026-07-10)
- Dragging a bar on the calendar now persists. `CalendarView.tsx` sets `editable: true`
  (+ `eventStartEditable`/`eventDurationEditable`) and wires `eventDrop`/`eventResize`, which
  call new `onUpdateEvent`/`onUpdateTask` props (App.tsx passes its existing `updateEvent`/
  `updateTask` — same write-row-then-flag-dirty path the detail panel Save uses, so drops push
  to CalDAV on the next sync).
- A `shiftStored(v, deltaMs)` helper moves a stored value by the drag delta while **preserving
  its shape**: a date-only "YYYY-MM-DD" stays date-only and shifts by whole days (off a noon
  anchor so a DST hour can't bump it a day), a full datetime stays an ISO UTC string. Drops shift
  the stored field by the delta rather than re-serializing the library's date, so all-day end
  semantics and null `end_date` aren't disturbed — the one exception is a drag that crosses the
  week/day all-day boundary, where we rebuild start/end from the library dates and flip `all_day`.
- Task bars map by display mode: "due" shifts `due_date`, "start" shifts `start_date` (due
  fallback), "range" shifts both ends. Resize is enabled for events (both edges → start/end) and
  for tasks only in "range" mode (left edge → `start_date`, right edge → `due_date`); single-day
  "due"/"start" bars set `durationEditable: false` since there's no second field to grow into.
- **Recurring events/tasks are locked** for drag/resize (`editable: false` per-item, plus a guard
  in both handlers that calls `info.revert()`) because they're whole-series only, so a drag would
  silently shift the entire series. (As of 2026-07-11 they now render every occurrence across the
  visible grid, not just the first — see "RRULE grid expansion" above — but stay drag-locked until
  per-occurrence editing lands in recurring part 2.)
- Not yet compiler-verified in this session — the sandbox couldn't run `tsc`/`vite` (Windows-
  installed node_modules lack Linux binaries, and the shell mount was returning truncated file
  reads). Verified by inspection; run `npm run build` on Windows to confirm.

## Android VALARM notifications — DONE (2026-07-10)
- Retested and confirmed working (user verified 2026-07-10, second Android device). The earlier
  non-delivery traced to the primary test phone, not Tasks Desktop's VALARM output.

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

## Notes sync — NEEDS RESEARCH + PLAN (added 2026-07-15)
- Idea raised while thinking about the server-installation variant: add **Notes** as a synced
  object type alongside tasks/events/contacts. Requires real research + a plan before building —
  parked deliberately.
- **Protocol findings (2026-07-15):** notes are NOT a CardDAV thing (that's contacts only). The
  standards path is **CalDAV carrying `VJOURNAL`** (iCalendar RFC 5545) — same protocol family as
  our `VEVENT`/`VTODO`, so we could reuse the existing CalDAV account/sync plumbing and add a third
  component type. ical.js already parses vCard/iCal, so a `VJOURNAL` parser is in reach.
- **The catch — server + client support is thin.** `VJOURNAL` is rarely used; support is uneven.
  On Android the only app that syncs notes as `VJOURNAL` over CalDAV is **jtx Board (via DAVx5)**.
  And the **CalDAV server itself must accept `VJOURNAL`** — many don't. **Synology is the open
  question**: Synology Calendar's CalDAV is built around events + tasks, and Synology's own notes
  product (Note Station) uses a separate non-DAV sync. So `VJOURNAL` against this user's Synology
  is unverified — **test first** (push one note via jtx Board, or PUT a minimal `VJOURNAL`, and see
  if it sticks) before designing anything on this path.
- **Fallback if Synology rejects `VJOURNAL`:** **WebDAV file sync** — notes as plain Markdown/txt
  files over WebDAV (the Joplin / Standard Notes / Nextcloud Notes model). This is the "third thing"
  — a separate subsystem, doesn't touch CalDAV/CardDAV code, won't merge into the calendar/contacts
  collections. Synology does expose WebDAV, so it's viable but is its own integration.
- **When the app becomes a server too** (see bundled-server section below): if we embed a CalDAV
  server, we control whether it accepts `VJOURNAL`, which removes the Synology-support blocker for
  self-hosted users — worth weighing the notes-as-`VJOURNAL` path as part of that build.
- Sources captured: DAVx5 manual (Tasks/Notes/Journals), jtx Board sync docs.

### Markdown notes — user's preferred direction (added 2026-07-15)
- User preference is **Markdown notes**, not iCal `VJOURNAL`. Wants, roughly in order:
  1. **A Notes tab that views + edits Markdown files from an existing folder** on disk — no sync
     required for v1. This is the easy, high-value first step: a folder picker (reuse the
     directory-access flow), a file tree, and a Markdown editor/preview pane. Pure local, no
     protocol. Could ship well before any server work.
  2. **Markdown note *syncing*** later, ideally tied into the bundled server vision below. Since
     Markdown is file-based, the natural sync is **file sync (WebDAV/S3/folder replication)**, not
     CalDAV — the notes live as `.md` files, so any file-sync transport works and interops with
     other Markdown tools.
- **Interop reference — Obsidian.** Since the audience overlaps with Obsidian users, worth
  designing so a notes folder can double as (or sit next to) an Obsidian vault:
  - **Obsidian Self-hosted LiveSync** (community plugin, vrtmrz): syncs a vault via **CouchDB
    replication** (documents + revisions, not file diffs), near-real-time (~1-2s), optional
    **P2P over WebRTC** (no server), and **end-to-end encrypted** with a passphrase (server never
    sees plaintext). Heavier backend (CouchDB) but the gold standard for self-hosted Obsidian sync.
  - **Remotely Save** (Obsidian plugin): simpler file-based sync over **WebDAV/S3/Dropbox** — closer
    to what our own server could expose, and less infrastructure than CouchDB.
- **Fit with the bundled server (below):** when we build the embedded server, adding a Markdown
  notes surface is attractive — either (a) serve the notes folder over **WebDAV** so Obsidian
  (Remotely Save) and mobile file-sync clients can reach it, or (b) go further and speak CouchDB
  replication for true Obsidian-LiveSync interop (bigger lift). Decision deferred; v1 is the
  local folder-backed Notes tab, sync comes with the server.
- Sources captured: Obsidian Self-hosted LiveSync (GitHub vrtmrz/obsidian-livesync), Remotely Save.

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
