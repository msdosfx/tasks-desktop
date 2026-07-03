# Roadmap / ideas to circle back to

## Next up
- **Calendar view** — circle back to this after the recurrence + hide-until work ships.
  Before designing it, look at **Rainlendar**: a lot of Tasks.org users run it as their
  desktop calendar. Worth checking (a) what its task/event UI gets right, and (b) whether
  we can interoperate directly — Rainlendar can read iCalendar files and (in the Pro
  version) speak CalDAV, so it may be able to point at the same CalDAV calendars this app
  syncs with, giving users a desktop calendar overlay for free without us building one.

## Reminders / notifications
- Main-process scheduler + Electron's native `Notification` API (Windows Action Center /
  libnotify on Linux). Timed tasks fire at their time; date-only tasks at a configurable
  default hour (Tasks.org uses 18:00). Needs "launch at login" + "close to tray" options
  to be useful, since notifications only fire while the app runs.

## Bundled CalDAV server ("self-contained" variant)
- Idea: a package variant that ships its own CalDAV server, so sync works with zero
  external setup and phones running Tasks.org/DAVx5 can sync straight to the desktop app.
- Candidates: **Radicale** (Python, tiny, easiest to embed), **Baïkal** (PHP, heavier),
  **xandikos** (Python, pure-Git storage). Radicale is the obvious first pick; an
  alternative is implementing a minimal CalDAV subset (PROPFIND/REPORT/PUT/DELETE on
  VTODOs) directly in the Electron main process, since we already have tsdav + ical.js.
- Open questions: how phones reach it (LAN discovery? static IP? TLS?), auth story,
  whether it runs only while the app is open, and whether that's acceptable for DAVx5's
  periodic sync.

## Smaller items
- Manual drag-to-reorder (sort_order already exists in DB + sync)
- Saved filters / smart lists
- Snooze / repeating reminders once notifications exist
