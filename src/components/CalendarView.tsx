import { useEffect, useMemo, useRef, useState } from "react";
import { createCalendar, destroyCalendar, DayGrid, Interaction } from "@event-calendar/core";
import "@event-calendar/core/index.css";
import { CalendarEvent, Task, TaskList } from "../types";
import { selectWidth } from "../selectWidth";

export type CalendarShow = "both" | "tasks" | "events";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  lists: TaskList[];
  calendarShow: CalendarShow;
  onSetCalendarShow: (v: CalendarShow) => void;
  onSelectTask: (id: string) => void;
  onSelectEvent: (id: string) => void;
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

export default function CalendarView({
  events, tasks, lists, calendarShow, onSetCalendarShow, onSelectTask, onSelectEvent, listFilter, onSetListFilter
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  const [ready, setReady] = useState(false);
  // Refs so the mount-once eventClick handler always calls the latest
  // callback, even though createCalendar() itself only runs once.
  const onSelectTaskRef = useRef(onSelectTask);
  const onSelectEventRef = useRef(onSelectEvent);
  useEffect(() => { onSelectTaskRef.current = onSelectTask; });
  useEffect(() => { onSelectEventRef.current = onSelectEvent; });
  const [categoryFilter, setCategoryFilter] = useState(() => localStorage.getItem("calendarCategoryFilter") || "all");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    () => (localStorage.getItem("calendarTaskDisplayMode") as DisplayMode) || "due"
  );
  // The display-mode select shows a short label when closed and expands to
  // the full description while focused/open, then shrinks back on blur.
  const [displayModeFocused, setDisplayModeFocused] = useState(false);

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
          start: e.start_date,
          end: e.end_date || e.start_date,
          allDay: !!e.all_day,
          backgroundColor: colorFor(e.list_id),
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
            classNames: ["task-bar"],
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
          classNames: ["task-bar"],
          extendedProps: { kind: "task" }
        });
      }
    }
    return out;
  }

  // Mount once.
  useEffect(() => {
    if (!elRef.current) return;
    ecRef.current = createCalendar(elRef.current, [DayGrid, Interaction], {
      view: "dayGridMonth",
      events: buildEcEvents(),
      eventClick(info: any) {
        const id = String(info?.event?.id ?? "");
        if (id.startsWith("task-")) onSelectTaskRef.current(id.slice(5));
        else if (id.startsWith("event-")) onSelectEventRef.current(id.slice(6));
      }
    });
    setReady(true);
    return () => {
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
  }, [ready, events, tasks, calendarShow, lists, categoryFilter, displayMode, listFilter]);

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
    </div>
  );
}
