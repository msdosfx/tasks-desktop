import { CalendarEvent, TaskList } from "../types";

interface Props {
  event: CalendarEvent | null;
  lists: TaskList[];
}

/** Formats a stored date ("YYYY-MM-DD" or full ISO datetime) for display. */
function formatDate(v: string | null, allDay: boolean): string {
  if (!v) return "";
  if (allDay || v.length <= 10) {
    const d = new Date(`${v.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(v).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  });
}

/** Read-only view of a CalDAV event. Events are a read-only mirror for now
 *  (see docs/calendar-plan.md) -- no eventToVEvent/push sync exists yet, so
 *  there's nothing to save even if this had editable fields. */
export default function EventDetailPanel({ event, lists }: Props) {
  if (!event) {
    return <div className="detail-panel"><div className="no-selection">Select a task or event to see details.</div></div>;
  }

  const list = lists.find((l) => l.id === event.list_id);
  const tags = event.tags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="detail-panel event-detail-panel">
      <h3>{event.title}</h3>
      <p className="event-readonly-note">
        This is a calendar event synced from {list?.name || "a CalDAV calendar"}. Event editing
        isn't supported yet — only tasks can be edited in this app.
      </p>

      <label>Calendar</label>
      <div className="event-field">
        <span className="today-pane-dot" style={{ background: list?.color || "#4a90d9" }} />
        {list?.name || "Unknown"}
      </div>

      {event.location && (<><label>Location</label><div className="event-field">{event.location}</div></>)}

      <label>When</label>
      <div className="event-field">
        {formatDate(event.start_date, !!event.all_day)}
        {event.end_date && event.end_date !== event.start_date && (
          <> – {formatDate(event.end_date, !!event.all_day)}</>
        )}
      </div>

      {event.recurrence && (<><label>Repeats</label><div className="event-field">{event.recurrence}</div></>)}

      {tags.length > 0 && (
        <>
          <label>Categories</label>
          <div className="category-input-wrap">
            {tags.map((t) => <span key={t} className="category-tag">{t}</span>)}
          </div>
        </>
      )}

      {event.notes && (<><label>Notes</label><div className="event-field event-notes">{event.notes}</div></>)}
    </div>
  );
}
