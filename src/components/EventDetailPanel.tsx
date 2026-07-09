import { useEffect, useState } from "react";
import { CalendarEvent, TaskList } from "../types";

interface Props {
  event: CalendarEvent | null;
  lists: TaskList[];
  allCategories?: string[];
  onUpdate: (id: string, patch: Partial<CalendarEvent>) => void;
  onDelete: (id: string) => void;
}

/** Splits a stored value ("YYYY-MM-DD" or full ISO datetime) into local-time
 *  date and time input values. Time is "" for date-only (all-day) events. */
function splitDateTime(v: string | null): { date: string; time: string } {
  if (!v) return { date: "", time: "" };
  if (v.length <= 10) return { date: v, time: "" };
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}

/** Date-only stays a plain "YYYY-MM-DD" (all-day, synced as an iCal DATE);
 *  with a time it becomes a full ISO datetime (synced as DATE-TIME). Same
 *  convention as tasks: whether a time was entered decides all-day-ness,
 *  there's no separate toggle. */
function joinDateTime(date: string, time: string): string | null {
  if (!date) return null;
  if (!time) return date;
  return new Date(`${date}T${time}`).toISOString();
}

/** Formats a stored date for the read-only view used for recurring events. */
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

export default function EventDetailPanel({ event, lists, allCategories = [], onUpdate, onDelete }: Props) {
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(event?.title ?? "");
    setListId(event?.list_id ?? "");
    setLocation(event?.location ?? "");
    const sd = splitDateTime(event?.start_date ?? null);
    setStartDate(sd.date); setStartTime(sd.time);
    const ed = splitDateTime(event?.end_date ?? null);
    setEndDate(ed.date); setEndTime(ed.time);
    setNotes(event?.notes ?? "");
    setTags(event?.tags ?? "");
    setDirty(false);
  }, [event?.id]);

  if (!event) {
    return <div className="detail-panel"><div className="no-selection">Select a task or event to see details.</div></div>;
  }

  const list = lists.find((l) => l.id === event.list_id);
  const isNew = !event.caldav_uid;

  // Recurring events stay read-only in this pass -- editing one occurrence
  // vs. the whole series needs its own UI (see docs/roadmap.md "Recurring
  // event editing"). This never applies to newly-created local events since
  // creating a recurring event isn't supported yet either.
  if (event.recurrence) {
    const tagList = event.tags.split(",").map((t) => t.trim()).filter(Boolean);
    return (
      <div className="detail-panel event-detail-panel">
        <h3>{event.title}</h3>
        <p className="event-readonly-note">
          This is a recurring event synced from {list?.name || "a CalDAV calendar"}. Editing recurring
          events isn't supported yet — only single (non-repeating) events can be edited.
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

        <label>Repeats</label>
        <div className="event-field">{event.recurrence}</div>

        {tagList.length > 0 && (
          <>
            <label>Categories</label>
            <div className="category-input-wrap">
              {tagList.map((t) => <span key={t} className="category-tag">{t}</span>)}
            </div>
          </>
        )}

        {event.notes && (<><label>Notes</label><div className="event-field event-notes">{event.notes}</div></>)}
      </div>
    );
  }

  function markDirty() {
    setDirty(true);
  }

  function handleSave() {
    const start = joinDateTime(startDate, startTime);
    if (!start) return; // start date is required
    onUpdate(event!.id, {
      title: title.trim() || event!.title,
      list_id: listId,
      location,
      all_day: startTime ? 0 : 1,
      start_date: start,
      end_date: joinDateTime(endDate, endTime),
      notes,
      tags
    });
    setDirty(false);
  }

  return (
    <div className="detail-panel event-detail-panel">
      <h3>Event details</h3>

      <label>Title</label>
      <input
        type="text"
        value={title}
        onChange={(e) => { setTitle(e.target.value); markDirty(); }}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
      />

      <label>Calendar</label>
      {isNew ? (
        <select value={listId} onChange={(e) => { setListId(e.target.value); markDirty(); }}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      ) : (
        <div className="event-field" title="Moving a synced event to a different calendar isn't supported yet">
          <span className="today-pane-dot" style={{ background: list?.color || "#4a90d9" }} />
          {list?.name || "Unknown"}
        </div>
      )}

      <label>Location</label>
      <input type="text" value={location} onChange={(e) => { setLocation(e.target.value); markDirty(); }} />

      <div className="detail-row">
        <div>
          <label>Start</label>
          <div className="date-time-pair">
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!e.target.value) setStartTime(""); markDirty(); }} />
            <input type="time" value={startTime} disabled={!startDate} title={startDate ? "Optional time — leave blank for an all-day event" : "Set a date first"}
              onChange={(e) => { setStartTime(e.target.value); markDirty(); }} />
          </div>
        </div>
        <div>
          <label>End</label>
          <div className="date-time-pair">
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); if (!e.target.value) setEndTime(""); markDirty(); }} />
            <input type="time" value={endTime} disabled={!endDate} title={endDate ? "Optional time — leave blank for an all-day event" : "Set a date first"}
              onChange={(e) => { setEndTime(e.target.value); markDirty(); }} />
          </div>
        </div>
      </div>

      <label>Categories</label>
      <datalist id="event-category-suggestions">
        {allCategories.map((c) => <option key={c} value={c} />)}
      </datalist>
      <div className="category-input-wrap">
        {tags.split(",").map((c) => c.trim()).filter(Boolean).map((cat) => (
          <span key={cat} className="category-tag">
            {cat}
            <button onClick={() => {
              const updated = tags.split(",").map((c) => c.trim()).filter((c) => c && c !== cat).join(", ");
              setTags(updated); markDirty();
            }}>×</button>
          </span>
        ))}
        <input
          type="text"
          list="event-category-suggestions"
          className="category-add-input"
          placeholder="Add category…"
          onChange={(e) => {
            const val = e.target.value.trim();
            if (val && allCategories.includes(val)) {
              const existing = tags.split(",").map((c) => c.trim()).filter(Boolean);
              if (!existing.includes(val)) {
                setTags([...existing, val].join(", "));
                markDirty();
              }
              e.target.value = "";
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) {
                const existing = tags.split(",").map((c) => c.trim()).filter(Boolean);
                if (!existing.includes(val)) {
                  setTags([...existing, val].join(", "));
                  markDirty();
                }
                (e.target as HTMLInputElement).value = "";
              }
            }
          }}
        />
      </div>

      <label>Notes</label>
      <textarea value={notes} onChange={(e) => { setNotes(e.target.value); markDirty(); }} />

      <div className="detail-actions">
        <button className="primary" onClick={handleSave} disabled={!dirty || !startDate}>{dirty ? "Save" : "Saved"}</button>
        <button className="danger" onClick={() => onDelete(event.id)}>Delete</button>
      </div>
      {event.caldav_uid && <div style={{ marginTop: 10, fontSize: 11, color: "#777" }}>Synced via CalDAV</div>}
    </div>
  );
}
