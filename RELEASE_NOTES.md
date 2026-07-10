Tasks Desktop v0.2.0 — Calendar release

The headline of this release is a full calendar view, plus reminders/notifications and recurring-event editing.

## Calendar view (new)
- A month/week/day calendar showing your tasks and events together. Toggle between showing tasks, events, or both.
- Week and Day are true hourly grids with a current-time line; Month is a scrollable grid.
- Task display modes: draw tasks by their due date, their start date, or as a start→due range.
- Filter the calendar by list/calendar and by category, independent of the main task view.
- Create items right on the calendar: double-click (or right-click) a day or a time slot to make a new event or task there — a clicked time slot prefills the time and defaults a 1-hour span.
- Click any item to select and edit it in the detail panel.

## Calendar events
- Events are now fully editable — create, edit, and delete — not just a read-only mirror. Changes sync two-way over CalDAV alongside your tasks.

## Recurring events
- Create and edit recurring events with quick presets (daily / weekly / monthly / yearly) or a custom RRULE. Edits apply to the whole series and sync correctly. (The grid currently shows a recurring event on its first occurrence; the rule itself round-trips to your server intact.)

## Drag to reschedule
- Drag an event or task bar to a new day or time and it sticks — the change is saved and pushed to CalDAV on the next sync. Drag an event's edge to change its duration; task bars in start→due range mode can be resized the same way.
- Recurring events are intentionally not draggable yet (they'd shift the whole series).

## Reminders & notifications
- Set multiple reminders per task or event — at the time it's due, or a chosen number of minutes / hours / days before.
- Native desktop notifications; clicking one jumps straight to the task or event.
- Reminders sync as CalDAV VALARMs, so Android clients (DAVx5 + Etar, Tasks.org mobile, etc.) can see and fire them too. (Note: some servers, including Synology, strip VALARMs — in that case reminders still work locally in this app.)

## Layout
- The sidebar and the right-hand Today/detail rail can each collapse (with a slim tab to re-expand), giving the calendar or task list more room on smaller windows.

## Fixes
- Fixed a calendar month-view timezone bug where an event's time badge could show the wrong hour.
- Month view now scrolls as a whole instead of a busy day stretching its week row.
- Sync hardening: fixed data-loss edge cases and the `events.tags` migration.
