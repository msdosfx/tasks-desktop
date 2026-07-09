# Calendar feature research + build plan

Written 2026-07-09. Follows up on `roadmap.md`'s "Calendar view — Next up" item.

## What we already have to build on

- `ical.js` and `rrule` are already dependencies, already used for task recurrence
  (`electron/ical.ts`, `RECUR_PRESETS` in `DetailPanel.tsx`).
- `tsdav` already does CalDAV discovery/auth/sync (`electron/caldav.ts`) — protocol-level,
  doesn't care whether a calendar object is a VTODO or VEVENT.
- **Gap**: `electron/ical.ts` only has `taskToVTodo`/`parseVTodo`. There's no VEVENT
  parsing/generation at all, and no `events` table in `db.ts`. A calendar of "the things
  going on around your tasks" needs actual calendar events, not just task due dates.

## Feature survey

| App | License / stack | Notable features worth stealing |
|---|---|---|
| **Thunderbird (Lightning)** | Mozilla Public License, XUL/Rust | Unified event+task view, per-calendar colors/visibility toggles, attendee invites (iTIP), snooze-able reminders, multi-calendar overlay, iCalendar import/export. |
| **Rainlendar** | Freeware (Pro paid), C++ | Desktop-embedded/skinnable widget rather than a full app window — always-visible mini calendar. CalDAV (Pro). Mixes calendars + to-do lists in one skin. Your `roadmap.md` already flags this as a possible *interop* target, not just inspiration — see "Build vs. interop" below. |
| **GNOME Calendar** | GPL, GTK/C, via evolution-data-server | Clean month/week/year views, quick-add via natural-language-ish single field, search. Backend (EDS + libical) is shared across GNOME Calendar/Todo/Contacts — same "one sync backend, many frontends" idea this app already follows with CalDAV. |
| **Evolution** | GPL, GTK/C | Full PIM suite: multiple task/memo lists with per-list colors, task assignment to attendees via email, "Collection accounts" (one login → mail+cal+tasks+contacts, same pattern as this app's CalDAV account model). |
| **KOrganizer** | GPL, Qt/C++, via Akonadi | Quick-add-todo single-line field (fast task entry without opening the editor — worth copying), merges multiple calendar sources transparently, strong recurrence UI, journal entries (a feature nobody else here has). |
| **Outlook** | Proprietary | Scheduling Assistant (free/busy across attendees), delegate access (someone else manages your calendar), room/resource booking. Mostly org/enterprise features — low priority for a single-user desktop tasks app. |
| **Google Calendar** | Proprietary | "Find a time" auto-suggest, appointment-slot booking pages, fast lightweight UI, huge integration ecosystem. Same story — most value is in the multi-person scheduling angle, which isn't this app's use case. |

## Feature menu to choose from

Grouped roughly cheapest → most work:

1. **Read-only month/week view of task due dates** — no new sync, no VEVENT support,
   just a calendar-shaped view over data already in the `tasks` table. Cheapest possible
   "calendar."
2. **True VEVENT support**: new `events` table, `eventToVEvent`/`parseVEvent` in
   `electron/ical.ts`, sync loop in `caldav.ts` alongside the existing VTODO loop, CRUD
   IPC handlers, `types.ts` additions.
3. **Calendar grid UI** (month/week/day) showing events + task due dates together,
   color-coded per list/calendar, click-to-create, drag-to-reschedule.
4. **Recurrence in the UI** — already have `rrule`/`ical.js` doing the heavy lifting for
   tasks; extend the same recurrence editor to events.
5. **Quick-add field** (KOrganizer-style single-line fast entry) for both events and tasks.
6. **Multi-calendar overlay** — per-calendar show/hide + color, like Thunderbird/Evolution/
   GNOME Calendar all do. Natural fit since accounts already support multiple linked lists.
7. **Reminders for events** — this app already has a notification scheduler for tasks
   (`checkReminders` in `main.ts`); extend it to fire on event start times too.
8. **Attendees/invites (iTIP)** — Thunderbird/Evolution/Outlook all do this. Significant
   scope (email sending, RSVP handling) and probably out of scope for a single-user local
   app — flagging as explicitly *not recommended* unless you want it.
9. **Journal/notes entries** (KOrganizer's VJOURNAL) — niche, low priority.

## Build vs. interop

Your own `roadmap.md` already raised this: Rainlendar (and GNOME Calendar, Evolution,
KOrganizer, etc.) can all point directly at the *same* CalDAV calendars this app syncs
with. That means "give users a calendar" doesn't strictly require building one — pointing
users at Rainlendar/GNOME Calendar/whatever with the same server URL/credentials already
works today, zero code.

Trade-off:
- **Interop-only**: ~0 engineering cost, but the task and calendar experience live in two
  separate windows/apps, and the "one app for tasks + calendar" pitch goes away.
- **Build it in**: matches the app's whole premise (Tasks.org-compatible, self-contained,
  one CalDAV account model for everything), but is real scope — items 2 and 3 above are
  the floor for anything beyond a read-only due-date view.

Given the app's stated direction (self-contained CalDAV story, eventual bundled-server
goal in `roadmap.md`), building it in is probably the right call long-term, but a
read-only due-date calendar (item 1) is a legitimate, cheap first milestone if you want
something visible fast.

## Reusable open-source pieces (not full apps — none of the apps above are realistically
embeddable in an Electron/React/TS app; they're GTK/Qt/XUL native apps)

- **Calendar grid UI library** (this is the actual time-saver): `@fullcalendar/react` is
  the most mature (month/week/day/list views, drag-drop, resizing, recurring-event
  rendering built in) — MIT-core with some paid premium views we wouldn't need. Alternative:
  `vkurko/calendar` (also MIT, framework-agnostic, actively maintained, no paid tier) or
  TUI Calendar (Toast UI, also solid). Any of these removes most of the "build a month
  grid with drag-to-reschedule" work.
- **Recurrence/parsing**: already covered by `ical.js` + `rrule`, already in
  `package.json`. No new dependency needed there.
- **CalDAV protocol**: already covered by `tsdav`. No new dependency needed.

## Suggested phased plan

1. **Phase 0** — decide build-vs-interop (above), and if building, pick a grid library
   (recommend `vkurko/calendar` or `@fullcalendar/react`; both are React-friendly).
2. **Phase 1** — VEVENT data layer: `events` table in `db.ts`, `eventToVEvent`/`parseVEvent`
   in `ical.ts`, extend `caldav.ts`'s sync loop to pull/push events alongside VTODOs
   (reuse the existing etag/dirty-flag machinery — same shape as the task sync we just
   built the launch/save triggers for).
3. **Phase 2** — calendar grid view (new `CalendarView.tsx`), wired to the chosen library,
   read+write against the new events IPC handlers. Show task due dates on the same grid
   as a distinct visual type.
4. **Phase 3** — recurrence editor reuse, per-calendar color/visibility toggles, quick-add
   field.
5. **Phase 4 (optional/low priority)** — reminders-for-events (extend `checkReminders`),
   journal entries, attendees/invites if actually wanted.

## Open questions for you

- Build-in vs. interop-first (cheap stopgap now, build later)?
- If building: which grid library — `vkurko/calendar`, `@fullcalendar/react`, or TUI Calendar?
- Is multi-attendee/invite support actually something you want, or explicitly out of scope?
