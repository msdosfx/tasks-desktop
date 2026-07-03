# Roadmap / ideas to circle back to

## Next up
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
