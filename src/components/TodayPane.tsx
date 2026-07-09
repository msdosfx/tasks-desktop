import { useState } from "react";
import { CalendarEvent, Task, TaskList } from "../types";
import { CalendarShow } from "./CalendarView";
import { selectWidth } from "../selectWidth";

interface Props {
  tasks: Task[];
  events: CalendarEvent[];
  lists: TaskList[];
  onSelectTask: (id: string) => void;
  onSelectEvent: (id: string) => void;
}

function todayStr(): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function isToday(dateStr: string | null, today: string): boolean {
  if (!dateStr) return false;
  return dateStr.slice(0, 10) === today;
}

/** True for single-day events today, and for multi-day events currently
 *  spanning today (e.g. a vacation Mon–Fri shows all week, not just on Mon). */
function eventIsToday(e: CalendarEvent, today: string): boolean {
  const start = e.start_date.slice(0, 10);
  const end = (e.end_date || e.start_date).slice(0, 10);
  return start <= today && today <= end;
}

type Row =
  | { kind: "task"; id: string; sortKey: string; listId: string; title: string; label: string }
  | { kind: "event"; id: string; sortKey: string; listId: string; title: string; label: string };

const showLabel: Record<CalendarShow, string> = {
  both: "Show both",
  tasks: "Show tasks",
  events: "Show events"
};

/** Thunderbird's Today Pane only shows things *starting* today. This one
 *  shows tasks due today and/or starting today (per the user's request) --
 *  a task can appear once even if both are true today -- plus today's (and
 *  ongoing multi-day) calendar events, with the same Show both/tasks/events
 *  filter as the calendar view. */
export default function TodayPane({ tasks, events, lists, onSelectTask, onSelectEvent }: Props) {
  const [show, setShow] = useState<CalendarShow>(() => (localStorage.getItem("todayPaneShow") as CalendarShow) || "both");
  const colorFor = (listId: string) => lists.find((l) => l.id === listId)?.color || "#4a90d9";
  const today = todayStr();

  const rows: Row[] = [];
  if (show !== "events") {
    for (const t of tasks) {
      if (t.completed || t.deleted) continue;
      if (!isToday(t.due_date, today) && !isToday(t.start_date, today)) continue;
      const due = isToday(t.due_date, today);
      const starts = isToday(t.start_date, today);
      rows.push({
        kind: "task",
        id: t.id,
        sortKey: t.due_date || t.start_date || "",
        listId: t.list_id,
        title: t.title,
        label: due && starts ? "starts & due" : due ? "due" : "starts"
      });
    }
  }
  if (show !== "tasks") {
    for (const e of events) {
      if (e.deleted) continue;
      if (!eventIsToday(e, today)) continue;
      rows.push({
        kind: "event",
        id: e.id,
        sortKey: e.start_date,
        listId: e.list_id,
        title: e.title,
        label: e.all_day ? "event" : "event"
      });
    }
  }
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <div className="today-pane">
      <div className="today-pane-header">
        <h3>Today</h3>
        <select
          className="due-filter-select"
          value={show}
          style={{ width: selectWidth(showLabel[show]) }}
          onChange={(e) => { const v = e.target.value as CalendarShow; setShow(v); localStorage.setItem("todayPaneShow", v); }}
        >
          <option value="both">Show both</option>
          <option value="tasks">Show tasks</option>
          <option value="events">Show events</option>
        </select>
      </div>
      {rows.length === 0 && <p className="today-pane-empty">Nothing due, starting, or on today.</p>}
      <ul className="today-pane-list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`} onClick={() => (r.kind === "task" ? onSelectTask(r.id) : onSelectEvent(r.id))}>
            <span className="today-pane-dot" style={{ background: colorFor(r.listId) }} />
            <span className="today-pane-title">{r.title}</span>
            <span className="today-pane-label">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
