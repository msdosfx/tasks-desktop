import { useEffect, useMemo, useRef, useState } from "react";
import { createCalendar, destroyCalendar, DayGrid, TimeGrid, Interaction } from "@event-calendar/core";
import "@event-calendar/core/index.css";
import { RRule } from "rrule";
import { CalendarEvent, EventOverride, Task, TaskList } from "../types";
import { selectWidth } from "../selectWidth";
import ContextMenu from "./ContextMenu";

export type CalendarShow = "both" | "tasks" | "events";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  lists: TaskList[];
  calendarShow: CalendarShow;
  onSetCalendarShow: (v: CalendarShow) => void;
  selectedTaskId: string | null;
  selectedEventId: string | null;
  onSelectTask: (id: string) => void;
  onSelectEvent: (id: string) => void;
  /** Fires with a "YYYY-MM-DD" date, to create a new (non-recurring) event
   *  there -- double-click a blank day, or "New Event" on its context menu. */
  onCreateEvent: (dateStr: string) => void;
  /** "New Task" on a day's context menu -- creates a task due that day. */
  onCreateTask: (dateStr: string) => void;
  listFilter: string; // "all" or a single list id
  onSetListFilter: (id: string) => void;
  /** Persist a drag/resize of an event bar (same path the detail panel's
   *  Save uses -- writes the row + flags it dirty for CalDAV push). */
  onUpdateEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  /** Persist a drag/resize of a task bar. */
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
}

type DisplayMode = "range" | "due" | "start";

/** One day after a date-only string ("YYYY-MM-DD"), for the exclusive `end`
 *  that all-day ranges use (matches iCalendar's own DTEND convention). */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function splitTags(tags: string): string[] {
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Strips the timezone off a stored UTC datetime, replacing it with the
 *  equivalent LOCAL wall-clock digits as a floating (no "Z"/offset) string.
 *  @event-calendar/core does its own timezone-offset math on whatever string
 *  it's given, and that math doesn't line up with how its event-time-badge
 *  text gets formatted (see the `eventTimeFormat` comment where the calendar
 *  is created) -- feeding it a real UTC "Z" string made the badge show the
 *  wrong hour (off by the local UTC offset) even though every other place in
 *  the app (Details panel, reminder notifications) reads the same stored
 *  value correctly via a plain `new Date(...).getHours()`. Handing the
 *  library an already-local, offset-free string sidesteps its conversion
 *  entirely -- there's nothing left for it to (mis)convert. All-day
 *  "YYYY-MM-DD" values pass through unchanged; they have no time-of-day
 *  component for this bug to affect. */
function toLocalFloating(v: string): string {
  if (v.length <= 10) return v;
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "YYYY-MM-DD" from a Date's LOCAL wall-clock date -- deliberately not
 *  toISOString().slice(0, 10), which converts to UTC and can land on the
 *  wrong day near midnight in negative-UTC-offset timezones. */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Shift a stored date value by `deltaMs`, PRESERVING its stored shape so a
 *  drag/resize round-trips through the same format the rest of the app reads:
 *  a date-only "YYYY-MM-DD" (all-day items, date-only task due/start) stays
 *  date-only and moves by whole days; a full datetime stays an ISO UTC string.
 *  Date-only shifting is done in whole days off a noon anchor so a DST
 *  transition inside the moved span can't nudge it onto the wrong calendar
 *  day (midnight ± a DST hour would). */
function shiftStored(v: string, deltaMs: number): string {
  if (v.length <= 10) {
    const days = Math.round(deltaMs / 86400000);
    const d = new Date(`${v.slice(0, 10)}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localDateStr(d);
  }
  return new Date(new Date(v).getTime() + deltaMs).toISOString();
}

/** Occurrence offsets (ms from the item's anchor date) for a recurring item's
 *  RRULE that land within [windowStart, windowEnd]. Returned as deltas -- not
 *  absolute dates -- so the caller can shift the item's *stored* start/due via
 *  shiftStored and reuse every existing format/timezone path: the interval
 *  between occurrences is what rrule.js gives us reliably, sidestepping its
 *  known absolute-UTC quirks. dtstart handling mirrors db.ts's nextOccurrence
 *  (date-only anchored at UTC midnight). Capped so a pathological rule can't
 *  emit unbounded bars. Returns [] on a malformed rule. */
function occurrenceDeltas(rruleStr: string, anchor: string, windowStart: Date, windowEnd: Date): number[] {
  try {
    const dateOnly = anchor.length <= 10;
    const dtstart = new Date(dateOnly ? `${anchor}T00:00:00Z` : anchor);
    const rule = new RRule({ ...RRule.parseString(rruleStr), dtstart });
    const occs = rule.between(windowStart, windowEnd, true).slice(0, 400);
    return occs.map((o) => o.getTime() - dtstart.getTime());
  } catch {
    return [];
  }
}

/** Epoch ms for an occurrence key, tolerant of date-only vs datetime, so a
 *  RECURRENCE-ID / EXDATE matches the occurrence regardless of string format. */
function occEpoch(v: string): number {
  return new Date(v.length <= 10 ? `${v}T00:00:00Z` : v).getTime();
}
function parseExdates(json: string | undefined): string[] {
  try { return JSON.parse(json || "[]"); } catch { return []; }
}
function parseOverrides(json: string | undefined): EventOverride[] {
  try { return JSON.parse(json || "[]"); } catch { return []; }
}

export default function CalendarView({
  events, tasks, lists, calendarShow, onSetCalendarShow, selectedTaskId, selectedEventId, onSelectTask, onSelectEvent, onCreateEvent, onCreateTask, listFilter, onSetListFilter, onUpdateEvent, onUpdateTask
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  const [ready, setReady] = useState(false);
  // The calendar's currently-visible date span (activeRange, incl. the
  // leading/trailing days a month view shows). Set by the datesSet handler on
  // mount and on every navigate/view change; recurring items are expanded only
  // across this window (Thunderbird-style), so `rangeVersion` bumps force a
  // rebuild whenever it moves.
  const visibleRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const [rangeVersion, setRangeVersion] = useState(0);
  const [dayMenu, setDayMenu] = useState<{ x: number; y: number; dateStr: string } | null>(null);
  // Refs so the mount-once eventClick handler and the DOM dblclick/contextmenu
  // listeners always call the latest callback, even though they're wired up
  // once and never re-attached.
  const onSelectTaskRef = useRef(onSelectTask);
  const onSelectEventRef = useRef(onSelectEvent);
  const onCreateEventRef = useRef(onCreateEvent);
  const onCreateTaskRef = useRef(onCreateTask);
  useEffect(() => { onSelectTaskRef.current = onSelectTask; });
  useEffect(() => { onSelectEventRef.current = onSelectEvent; });
  useEffect(() => { onCreateEventRef.current = onCreateEvent; });
  useEffect(() => { onCreateTaskRef.current = onCreateTask; });
  // Same latest-value pattern for the drag/resize handlers, which are wired
  // once at mount but need the current events/tasks (to read the row being
  // moved), the current task display mode (which task date a bar maps to),
  // and the update callbacks.
  const onUpdateEventRef = useRef(onUpdateEvent);
  const onUpdateTaskRef = useRef(onUpdateTask);
  const eventsRef = useRef(events);
  const tasksRef = useRef(tasks);
  useEffect(() => { onUpdateEventRef.current = onUpdateEvent; });
  useEffect(() => { onUpdateTaskRef.current = onUpdateTask; });
  useEffect(() => { eventsRef.current = events; });
  useEffect(() => { tasksRef.current = tasks; });
  const [categoryFilter, setCategoryFilter] = useState(() => localStorage.getItem("calendarCategoryFilter") || "all");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    () => (localStorage.getItem("calendarTaskDisplayMode") as DisplayMode) || "due"
  );
  // The display-mode select shows a short label when closed and expands to
  // the full description while focused/open, then shrinks back on blur.
  const [displayModeFocused, setDisplayModeFocused] = useState(false);
  // Month/week/day toggle -- replaces the library's default "today" header
  // button (see headerToolbar in the mount effect below), which sat there
  // not doing anything useful for this app. Week/day use the TimeGrid
  // plugin's hourly views (not DayGrid's dayGridWeek) so hours of the day
  // actually show, rather than just a strip of day cells like month view.
  const CAL_VIEWS: { view: "dayGridMonth" | "timeGridWeek" | "timeGridDay"; label: string }[] = [
    { view: "dayGridMonth", label: "Month" },
    { view: "timeGridWeek", label: "Week" },
    { view: "timeGridDay", label: "Day" }
  ];
  const [calView, setCalView] = useState<"dayGridMonth" | "timeGridWeek" | "timeGridDay">("dayGridMonth");

  useEffect(() => { localStorage.setItem("calendarCategoryFilter", categoryFilter); }, [categoryFilter]);
  useEffect(() => { localStorage.setItem("calendarTaskDisplayMode", displayMode); }, [displayMode]);
  const displayModeRef = useRef(displayMode);
  useEffect(() => { displayModeRef.current = displayMode; });

  const showTasks = calendarShow !== "events";
  const showEvents = calendarShow !== "tasks";

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const c of splitTags(t.tags)) set.add(c);
    for (const e of events) for (const c of splitTags(e.tags)) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks, events]);

  const colorFor = (listId: string) => lists.find((l) => l.id === listId)?.color || "#4a90d9";
  const matchesCategory = (tags: string) =>
    categoryFilter === "all" || splitTags(tags).includes(categoryFilter);

  // Occurrence offsets (ms) to draw a recurring item at. Non-recurring items
  // (and, defensively, recurring ones before the first datesSet has told us the
  // visible window) get a single [0] -- their stored date, unchanged. Recurring
  // items with a known window get one delta per occurrence inside it (padded 2
  // days each side so an occurrence right at the grid edge isn't clipped by
  // rrule/window timezone rounding); an empty result means the series simply
  // doesn't touch this view, so nothing is drawn -- the whole point of the
  // Thunderbird-style expansion replacing the old always-draw-the-base behavior.
  function deltasFor(recurrence: string | null, anchor: string): number[] {
    if (!recurrence) return [0];
    const range = visibleRangeRef.current;
    if (!range) return [0];
    const pad = 2 * 86400000;
    return occurrenceDeltas(recurrence, anchor, new Date(range.start.getTime() - pad), new Date(range.end.getTime() + pad));
  }

  function buildEcEvents() {
    const out: any[] = [];
    if (showEvents) {
      for (const e of events) {
        if (listFilter !== "all" && e.list_id !== listFilter) continue;
        if (!matchesCategory(e.tags)) continue;
        const recurring = !!e.recurrence;
        // Per-occurrence exceptions: dates the user removed (exdates) are
        // skipped entirely, and edited occurrences (overrides, keyed by their
        // original start = RECURRENCE-ID) are drawn with the override's values.
        const exSet = recurring ? new Set(parseExdates(e.exdates).map(occEpoch)) : null;
        const ovMap = recurring
          ? new Map(parseOverrides(e.overrides).map((o): [number, EventOverride] => [occEpoch(o.recurrence_id), o]))
          : null;
        const deltas = deltasFor(e.recurrence, e.start_date);
        deltas.forEach((d, i) => {
          // This occurrence's ORIGINAL start (its RECURRENCE-ID), used to match
          // exdates/overrides and, on click, to tell step 5 which one was hit.
          const occStart = shiftStored(e.start_date, d);
          if (exSet && exSet.has(occEpoch(occStart))) return; // removed occurrence
          const ov = ovMap ? ovMap.get(occEpoch(occStart)) : undefined;
          out.push({
            // Occurrences beyond the first need distinct ids (the library
            // rejects duplicates); the master id is carried in extendedProps so
            // clicks still resolve to the real event. The base occurrence keeps
            // the plain `event-<id>` so the (editable, non-recurring) drag path
            // that slices the id off is unaffected.
            id: recurring ? `event-${e.id}::${i}` : `event-${e.id}`,
            title: ov ? (ov.title || e.title) : e.title,
            start: toLocalFloating(ov ? ov.start_date : occStart),
            end: toLocalFloating(ov ? (ov.end_date || ov.start_date) : shiftStored(e.end_date || e.start_date, d)),
            allDay: ov ? !!ov.all_day : !!e.all_day,
            backgroundColor: colorFor(e.list_id),
            classNames: [
              ...(e.id === selectedEventId ? ["ec-selected"] : []),
              ...(recurring ? ["ec-recurring"] : [])
            ],
            // Recurring occurrences are read-only ghosts: they're whole-series
            // only, so a drag would silently shift the entire series. Locking
            // them (and reverting in the drag guards) keeps that safe.
            editable: !recurring,
            extendedProps: { kind: "event", location: e.location, masterId: e.id, recurring, occurrenceStart: recurring ? occStart : null }
          });
        });
      }
    }
    if (showTasks) {
      for (const t of tasks) {
        if (t.completed || t.deleted) continue;
        if (listFilter !== "all" && t.list_id !== listFilter) continue;
        if (!matchesCategory(t.tags)) continue;
        const recurring = !!t.recurrence;
        // Recurrence is anchored on the due date (Tasks.org convention, matching
        // db.ts's completion roll-forward); the same interval is applied to
        // whichever field(s) the current display mode actually draws.
        const anchor = t.due_date || t.start_date;
        if (displayMode === "start") {
          const startOnly = t.start_date || t.due_date;
          if (!startOnly) continue;
          const deltas = deltasFor(t.recurrence, anchor || startOnly);
          deltas.forEach((d, i) => {
            const s = shiftStored(startOnly, d);
            out.push({
              id: recurring ? `task-${t.id}::${i}` : `task-${t.id}`,
              title: t.title,
              start: s,
              end: nextDay(s),
              allDay: true,
              backgroundColor: colorFor(t.list_id),
              classNames: [
                "task-bar",
                ...(t.id === selectedTaskId ? ["ec-selected"] : []),
                ...(recurring ? ["ec-recurring"] : [])
              ],
              // Draggable to reschedule; not resizable in start/due mode -- a
              // single-day bar has no second date field to grow into (only the
              // start-due "range" mode does). Recurring occurrences stay locked.
              editable: !recurring,
              startEditable: !recurring,
              durationEditable: false,
              extendedProps: { kind: "task", masterId: t.id, recurring }
            });
          });
          continue;
        }
        const due = t.due_date || t.start_date;
        if (!due) continue;
        const start = displayMode === "range" ? t.start_date || due : due;
        const deltas = deltasFor(t.recurrence, anchor || due);
        deltas.forEach((d, i) => {
          const shiftedDue = shiftStored(due, d);
          out.push({
            id: recurring ? `task-${t.id}::${i}` : `task-${t.id}`,
            title: t.title,
            start: shiftStored(start, d),
            end: nextDay(shiftedDue),
            allDay: true,
            backgroundColor: colorFor(t.list_id),
            classNames: [
              "task-bar",
              ...(t.id === selectedTaskId ? ["ec-selected"] : []),
              ...(recurring ? ["ec-recurring"] : [])
            ],
            // Draggable to reschedule. Resizable only in "range" mode, where the
            // bar spans start_date..due_date and each edge maps to a real field;
            // "due" mode is a single-day bar with nothing to resize into.
            editable: !recurring,
            startEditable: !recurring,
            durationEditable: !recurring && displayMode === "range",
            extendedProps: { kind: "task", masterId: t.id, recurring }
          });
        });
      }
    }
    return out;
  }

  // Mount once.
  useEffect(() => {
    if (!elRef.current) return;
    ecRef.current = createCalendar(elRef.current, [DayGrid, TimeGrid, Interaction], {
      view: calView,
      // Default is `{start: 'title', center: '', end: 'today prev,next'}` --
      // drop "today" since our own Month/Week/Day toggle button (in
      // .calendar-view-toolbar below) replaces it.
      headerToolbar: { start: "title", center: "", end: "prev,next" },
      // Current-time marker line, only shown in the timeGrid week/day views.
      nowIndicator: true,
      // Enable drag-to-reschedule and edge-resize. Per-event `editable` /
      // `startEditable` / `durationEditable` flags in buildEcEvents() narrow
      // this down (recurring items locked, task bars resizable only in range
      // mode); eventDrop/eventResize below persist the result.
      editable: true,
      eventStartEditable: true,
      eventDurationEditable: true,
      // Default `true` stacks same-time events on top of each other with a
      // slight offset, which makes the ones underneath hard to click in
      // week/day view. `false` lays intersecting events side by side in
      // their own columns instead -- each stays independently clickable.
      slotEventOverlap: false,
      // Fires on mount and on every navigate/view change with the visible span
      // (activeRange). Stash it and bump rangeVersion so the reactive effect
      // re-expands recurring items for the new window. Guard against a no-op
      // re-fire (same bounds) so we don't loop.
      datesSet(info: any) {
        const cur = visibleRangeRef.current;
        if (cur && cur.start.getTime() === info.start.getTime() && cur.end.getTime() === info.end.getTime()) return;
        visibleRangeRef.current = { start: info.start, end: info.end };
        setRangeVersion((v) => v + 1);
      },
      events: buildEcEvents(),
      // A day with a lot of tasks/events stretches its whole week row taller
      // (library behavior, unchanged) -- `dayMaxEvents` turned out
      // unreliable here (`true` broke an unrelated week's layout, a fixed
      // number had no visible effect), and capping the day cell's own
      // height fought the library's row layout too. Instead the mount root
      // itself scrolls -- see `.calendar-view-grid { overflow-y: auto }` in
      // styles.css -- so a tall week just makes the grid scrollable instead
      // of pushing later weeks off screen.
      // @event-calendar/core's built-in time-badge text (driven by its
      // `eventTimeFormat` option) comes out wrong here -- off by the local
      // UTC offset -- even though the Details panel and reminder
      // notifications, which just do a plain `new Date(...).getHours()` on
      // the same stored value, show the correct time. Rather than continuing
      // to chase the library's internal conversion, render the time badge
      // ourselves: `arg.event.start`/`.end` here are already a correctly
      //-converted local `Date` (the library's own `toLocalDate()` helper),
      // so a plain `toLocaleTimeString` on it is trustworthy.
      eventContent(arg: any) {
        const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        // A small ↻ badge marks generated recurrence occurrences so they read
        // as "part of a series" rather than individually-stored items.
        const mark = arg.event.extendedProps?.recurring ? '<span class="ec-recur-mark" aria-label="repeats">↻</span>' : "";
        if (arg.event.allDay) {
          if (!mark) return undefined; // default (title-only) rendering is fine
          return { html: `${mark}<span class="ec-event-title">${escape(arg.event.title)}</span>` };
        }
        const timeText = (arg.event.start as Date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        return { html: `${mark}<time class="ec-event-time">${escape(timeText)}</time><h4 class="ec-event-title">${escape(arg.event.title)}</h4>` };
      },
      eventClick(info: any) {
        // A recurring occurrence's id has an `::<n>` suffix, so prefer the
        // master id stashed in extendedProps; fall back to slicing the prefix
        // off the plain `task-`/`event-` id for anything without it.
        const props = info?.event?.extendedProps ?? {};
        const id = String(info?.event?.id ?? "");
        if (props.kind === "task") onSelectTaskRef.current(props.masterId ?? id.slice(5));
        else if (props.kind === "event") onSelectEventRef.current(props.masterId ?? id.slice(6));
      },
      // Drag a bar to a new day/time. `info.event`/`info.oldEvent` carry the
      // library's already-local Date start/end; the millisecond diff between
      // them is the move, applied to the stored value via shiftStored (which
      // keeps date-only stays-date-only / datetime-stays-ISO). We shift the
      // *stored* field rather than re-serialize info.event so we don't disturb
      // all-day end semantics or a null end_date -- except when a drag crosses
      // the all-day boundary (week/day view has an all-day row), where we must
      // rebuild from the library dates and flip all_day.
      eventDrop(info: any) {
        const id = String(info?.event?.id ?? "");
        const deltaMs = (info.event.start as Date).getTime() - (info.oldEvent.start as Date).getTime();
        if (id.startsWith("event-")) {
          const ev = eventsRef.current.find((e) => e.id === id.slice(6));
          if (!ev || ev.recurrence) { info.revert?.(); return; }
          const wasAllDay = !!info.oldEvent.allDay;
          const nowAllDay = !!info.event.allDay;
          const patch: Partial<CalendarEvent> = {};
          if (wasAllDay === nowAllDay) {
            patch.start_date = shiftStored(ev.start_date, deltaMs);
            if (ev.end_date) patch.end_date = shiftStored(ev.end_date, deltaMs);
          } else {
            patch.all_day = nowAllDay ? 1 : 0;
            patch.start_date = nowAllDay ? localDateStr(info.event.start) : (info.event.start as Date).toISOString();
            if (ev.end_date && info.event.end) {
              patch.end_date = nowAllDay ? localDateStr(info.event.end) : (info.event.end as Date).toISOString();
            }
          }
          onUpdateEventRef.current(ev.id, patch);
        } else if (id.startsWith("task-")) {
          const t = tasksRef.current.find((x) => x.id === id.slice(5));
          if (!t || t.recurrence) { info.revert?.(); return; }
          const mode = displayModeRef.current;
          const patch: Partial<Task> = {};
          if (mode === "start") {
            if (t.start_date) patch.start_date = shiftStored(t.start_date, deltaMs);
            else if (t.due_date) patch.due_date = shiftStored(t.due_date, deltaMs);
          } else if (mode === "range") {
            // Whole bar moved -- shift both ends that exist by the same delta.
            if (t.start_date) patch.start_date = shiftStored(t.start_date, deltaMs);
            if (t.due_date) patch.due_date = shiftStored(t.due_date, deltaMs);
          } else {
            // "due" -- the bar is anchored to the due date (start fallback).
            if (t.due_date) patch.due_date = shiftStored(t.due_date, deltaMs);
            else if (t.start_date) patch.start_date = shiftStored(t.start_date, deltaMs);
          }
          if (Object.keys(patch).length) onUpdateTaskRef.current(t.id, patch);
          else info.revert?.();
        }
      },
      // Drag an edge to change duration. Resizes report separate startDelta /
      // endDelta; here we recompute each from the Date diff and move only the
      // edge(s) that actually changed. Events map to start_date/end_date; task
      // bars (range mode only, per durationEditable above) map their left edge
      // to start_date and right edge to due_date.
      eventResize(info: any) {
        const id = String(info?.event?.id ?? "");
        const startDeltaMs = (info.event.start as Date).getTime() - (info.oldEvent.start as Date).getTime();
        const endDeltaMs = (info.event.end as Date).getTime() - (info.oldEvent.end as Date).getTime();
        if (id.startsWith("event-")) {
          const ev = eventsRef.current.find((e) => e.id === id.slice(6));
          if (!ev || ev.recurrence) { info.revert?.(); return; }
          const patch: Partial<CalendarEvent> = {};
          if (startDeltaMs) patch.start_date = shiftStored(ev.start_date, startDeltaMs);
          if (endDeltaMs) patch.end_date = shiftStored(ev.end_date || ev.start_date, endDeltaMs);
          if (Object.keys(patch).length) onUpdateEventRef.current(ev.id, patch);
          else info.revert?.();
        } else if (id.startsWith("task-")) {
          const t = tasksRef.current.find((x) => x.id === id.slice(5));
          if (!t || t.recurrence) { info.revert?.(); return; }
          const patch: Partial<Task> = {};
          const startBase = t.start_date || t.due_date;
          const endBase = t.due_date || t.start_date;
          if (startDeltaMs && startBase) patch.start_date = shiftStored(startBase, startDeltaMs);
          if (endDeltaMs && endBase) patch.due_date = shiftStored(endBase, endDeltaMs);
          if (Object.keys(patch).length) onUpdateTaskRef.current(t.id, patch);
          else info.revert?.();
        }
      }
    });
    setReady(true);

    // A single click is used for selecting tasks/events, so day creation
    // needs its own gestures (Thunderbird-style): double-click a blank day to
    // create an event, or right-click for a menu with New Event/New Task/
    // month navigation. Both are attached as plain DOM listeners since the
    // Interaction plugin only offers a single-click dateClick.
    const el = elRef.current;
    function isOnEvent(target: EventTarget | null): boolean {
      return !!(target as HTMLElement)?.closest?.(".ec-event");
    }
    // In month view, dateFromPoint's `date` is midnight with no meaningful
    // time-of-day (allDay: true) -- only a plain "YYYY-MM-DD" makes sense
    // there. In week/day view, a click inside the hourly grid carries a real
    // time (allDay: false), so the full instant is passed through as an ISO
    // string instead, which createEventOnDate/createTaskOnDate (App.tsx)
    // detect via string length to prefill the time field and default a
    // 1-hour span.
    function pointToStr(info: { date: Date; allDay: boolean }): string {
      return info.allDay ? localDateStr(info.date) : info.date.toISOString();
    }
    function onDblClick(e: MouseEvent) {
      if (isOnEvent(e.target)) return;
      const info = ecRef.current?.dateFromPoint(e.clientX, e.clientY);
      if (!info?.date) return;
      onCreateEventRef.current(pointToStr(info));
    }
    function onContextMenu(e: MouseEvent) {
      if (isOnEvent(e.target)) return;
      const info = ecRef.current?.dateFromPoint(e.clientX, e.clientY);
      if (!info?.date) return;
      e.preventDefault();
      setDayMenu({ x: e.clientX, y: e.clientY, dateStr: pointToStr(info) });
    }
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("contextmenu", onContextMenu);
      if (ecRef.current) destroyCalendar(ecRef.current);
      ecRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive updates: push new event data whenever anything relevant changes,
  // without tearing down/recreating the calendar.
  useEffect(() => {
    if (!ready || !ecRef.current) return;
    ecRef.current.setOption("events", buildEcEvents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, events, tasks, calendarShow, lists, categoryFilter, displayMode, listFilter, selectedTaskId, selectedEventId]);

  useEffect(() => {
    if (!ready || !ecRef.current) return;
    ecRef.current.setOption("view", calView);
  }, [ready, calView]);

  const displayModeShortLabel: Record<DisplayMode, string> = {
    due: "Tasks: Due",
    start: "Tasks: Start",
    range: "Tasks: Start–Due"
  };
  const displayModeFullLabel: Record<DisplayMode, string> = {
    due: "Tasks: Due date only",
    start: "Tasks: Start date only",
    range: "Tasks: Start–due range"
  };
  const displayModeLabel = displayModeFocused ? displayModeFullLabel : displayModeShortLabel;
  const listFilterLabel = listFilter === "all" ? "List: All" : `List: ${lists.find((l) => l.id === listFilter)?.name ?? "All"}`;
  const showLabel: Record<CalendarShow, string> = {
    both: "Show both",
    tasks: "Show tasks",
    events: "Show events"
  };

  return (
    <div className="calendar-view">
      <div className="calendar-view-toolbar">
        <select
          className="due-filter-select"
          value={calView}
          title="Switch between month, week, and day view"
          style={{ width: selectWidth(CAL_VIEWS.find((v) => v.view === calView)?.label ?? "Month") }}
          onChange={(e) => setCalView(e.target.value as typeof calView)}
        >
          {CAL_VIEWS.map((v) => <option key={v.view} value={v.view}>{v.label}</option>)}
        </select>
        <select
          className="due-filter-select"
          value={calendarShow}
          title="Show tasks, events, or both on the calendar"
          style={{ width: selectWidth(showLabel[calendarShow]) }}
          onChange={(e) => onSetCalendarShow(e.target.value as CalendarShow)}
        >
          <option value="both">Show both</option>
          <option value="tasks">Show tasks</option>
          <option value="events">Show events</option>
        </select>
        <select
          className="due-filter-select"
          value={displayMode}
          disabled={!showTasks}
          title="How task dates are drawn on the calendar"
          style={{ width: selectWidth(displayModeLabel[displayMode]) }}
          onFocus={() => setDisplayModeFocused(true)}
          onBlur={() => setDisplayModeFocused(false)}
          onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
        >
          <option value="due">{displayModeLabel.due}</option>
          <option value="start">{displayModeLabel.start}</option>
          <option value="range">{displayModeLabel.range}</option>
        </select>
        <select
          className="due-filter-select"
          value={listFilter}
          title="Isolate the calendar to one list/calendar (same as right-click → Show only… in the sidebar)"
          style={{ width: selectWidth(listFilterLabel) }}
          onChange={(e) => onSetListFilter(e.target.value)}
        >
          <option value="all">List: All</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>List: {l.name}</option>
          ))}
        </select>
        {allCategories.length > 0 && (
          <select
            className="due-filter-select"
            value={categoryFilter}
            style={{ width: selectWidth(categoryFilter === "all" ? "Category: All" : categoryFilter) }}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Category: All</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      <div ref={elRef} className="calendar-view-grid ec-dark" />
      {dayMenu && (
        <ContextMenu
          x={dayMenu.x}
          y={dayMenu.y}
          onClose={() => setDayMenu(null)}
          items={[
            { label: "New Event", onClick: () => onCreateEventRef.current(dayMenu.dateStr) },
            { label: "New Task", onClick: () => onCreateTaskRef.current(dayMenu.dateStr) },
            { label: "Previous Month", onClick: () => ecRef.current?.prev() },
            { label: "Next Month", onClick: () => ecRef.current?.next() }
          ]}
        />
      )}
    </div>
  );
}
