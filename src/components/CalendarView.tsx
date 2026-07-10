import { useEffect, useMemo, useRef, useState } from "react";
import { createCalendar, destroyCalendar, DayGrid, TimeGrid, Interaction } from "@event-calendar/core";
import "@event-calendar/core/index.css";
import { CalendarEvent, Task, TaskList } from "../types";
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

export default function CalendarView({
  events, tasks, lists, calendarShow, onSetCalendarShow, selectedTaskId, selectedEventId, onSelectTask, onSelectEvent, onCreateEvent, onCreateTask, listFilter, onSetListFilter
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  const [ready, setReady] = useState(false);
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

  function buildEcEvents() {
    const out: any[] = [];
    if (showEvents) {
      for (const e of events) {
        if (listFilter !== "all" && e.list_id !== listFilter) continue;
        if (!matchesCategory(e.tags)) continue;
        out.push({
          id: `event-${e.id}`,
          title: e.title,
          start: toLocalFloating(e.start_date),
          end: toLocalFloating(e.end_date || e.start_date),
          allDay: !!e.all_day,
          backgroundColor: colorFor(e.list_id),
          classNames: e.id === selectedEventId ? ["ec-selected"] : [],
          extendedProps: { kind: "event", location: e.location }
        });
      }
    }
    if (showTasks) {
      for (const t of tasks) {
        if (t.completed || t.deleted) continue;
        if (listFilter !== "all" && t.list_id !== listFilter) continue;
        if (!matchesCategory(t.tags)) continue;
        if (displayMode === "start") {
          const startOnly = t.start_date || t.due_date;
          if (!startOnly) continue;
          out.push({
            id: `task-${t.id}`,
            title: t.title,
            start: startOnly,
            end: nextDay(startOnly),
            allDay: true,
            backgroundColor: colorFor(t.list_id),
            classNames: t.id === selectedTaskId ? ["task-bar", "ec-selected"] : ["task-bar"],
            extendedProps: { kind: "task" }
          });
          continue;
        }
        const due = t.due_date || t.start_date;
        if (!due) continue;
        const start = displayMode === "range" ? t.start_date || due : due;
        out.push({
          id: `task-${t.id}`,
          title: t.title,
          start,
          end: nextDay(due),
          allDay: true,
          backgroundColor: colorFor(t.list_id),
          classNames: t.id === selectedTaskId ? ["task-bar", "ec-selected"] : ["task-bar"],
          extendedProps: { kind: "task" }
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
      // Default `true` stacks same-time events on top of each other with a
      // slight offset, which makes the ones underneath hard to click in
      // week/day view. `false` lays intersecting events side by side in
      // their own columns instead -- each stays independently clickable.
      slotEventOverlap: false,
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
        if (arg.event.allDay) return undefined; // default (title-only) rendering is fine
        const timeText = (arg.event.start as Date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return { html: `<time class="ec-event-time">${escape(timeText)}</time><h4 class="ec-event-title">${escape(arg.event.title)}</h4>` };
      },
      eventClick(info: any) {
        const id = String(info?.event?.id ?? "");
        if (id.startsWith("task-")) onSelectTaskRef.current(id.slice(5));
        else if (id.startsWith("event-")) onSelectEventRef.current(id.slice(6));
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
