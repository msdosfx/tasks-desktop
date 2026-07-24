import { useEffect, useRef, useState } from "react";
import { CalendarEvent, TaskList } from "../types";
import RemindersEditor, { PendingReminder } from "./RemindersEditor";
import { RECURRING_PER_OCCURRENCE } from "../featureFlags";

type Scope = "all" | "this" | "following";

interface Props {
  event: CalendarEvent | null;
  lists: TaskList[];
  allCategories?: string[];
  /** The occurrence the user opened (its RECURRENCE-ID), when a specific
   *  occurrence of a recurring event was clicked on the calendar; null
   *  otherwise. Its presence enables the This / This-and-following / All prompt. */
  occurrenceStart?: string | null;
  onUpdate: (id: string, patch: Partial<CalendarEvent>) => void;
  onDelete: (id: string) => void;
  /** Apply an edit to just one occurrence ("this") or the occurrence onward
   *  ("following"). Whole-series ("all") edits go through onUpdate. */
  onUpdateScoped: (scope: "this" | "following", masterId: string, occurrenceStart: string, patch: Partial<CalendarEvent>) => void;
  /** Delete one occurrence ("this") or the occurrence onward ("following").
   *  Whole-series ("all") deletes go through onDelete. */
  onDeleteScoped: (scope: "this" | "following", masterId: string, occurrenceStart: string) => void;
  /** When true (set right after this event was just created), focus and select
   *  the title field so the user can type over the placeholder immediately.
   *  onTitleFocused clears the one-shot signal so it doesn't re-fire. */
  autoFocusTitle?: boolean;
  onTitleFocused?: () => void;
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

/** One hour after a local date+time, split back into date/time input values
 *  -- used to default the end date/time when a start time is set and end
 *  isn't, same convention as the calendar's time-slot click creation. */
function addOneHour(date: string, time: string): { date: string; time: string } {
  const d = new Date(`${date}T${time}`);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}

const RECUR_PRESETS: { label: string; value: string | null }[] = [
  { label: "Does not repeat", value: null },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Monthly", value: "FREQ=MONTHLY" },
  { label: "Yearly", value: "FREQ=YEARLY" }
];

export default function EventDetailPanel({ event, lists, allCategories = [], occurrenceStart = null, onUpdate, onDelete, onUpdateScoped, onDeleteScoped, autoFocusTitle, onTitleFocused }: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [recurMode, setRecurMode] = useState<string>("Does not repeat");
  const [customRecur, setCustomRecur] = useState("");
  const [reminders, setReminders] = useState<PendingReminder[]>([]);
  const [dirty, setDirty] = useState(false);
  // When a recurring occurrence is saved/deleted, we ask This / Following / All
  // first; the pending action (and, for saves, the built patch) lives here.
  const [scopePrompt, setScopePrompt] = useState<{ mode: "save"; patch: Partial<CalendarEvent> } | { mode: "delete" } | null>(null);

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
    const preset = RECUR_PRESETS.find((p) => p.value === (event?.recurrence ?? null));
    setRecurMode(preset ? preset.label : event?.recurrence ? "custom" : RECUR_PRESETS[0].label);
    setCustomRecur(event?.recurrence ?? "");
    setDirty(false);
    if (event?.id) {
      window.api.reminders?.for("event", event.id).then((rs) => {
        setReminders(rs.map((r) => ({ id: r.id, offset_minutes: r.offset_minutes })));
      });
    } else {
      setReminders([]);
    }
  }, [event?.id]);

  // Just-created events: clear the "New event" placeholder title so the field is
  // empty and ready to type into, then focus it. The stored title stays as a
  // fallback if the user saves without typing (see buildPatch), so nothing is
  // ever persisted blank.
  useEffect(() => {
    if (!autoFocusTitle || !event) return;
    setTitle("");
    const id = setTimeout(() => {
      titleRef.current?.focus();
      onTitleFocused?.();
    }, 0);
    return () => clearTimeout(id);
  }, [autoFocusTitle, event?.id]);

  if (!event) {
    return <div className="detail-panel"><div className="no-selection">Select a task or event to see details.</div></div>;
  }

  const list = lists.find((l) => l.id === event.list_id);
  const isNew = !event.caldav_uid;

  function markDirty() {
    setDirty(true);
  }

  function setRemindersDirty(next: PendingReminder[]) {
    setReminders(next);
    markDirty();
  }

  /** The edited fields, or null if the required start date is missing. */
  function buildPatch(): Partial<CalendarEvent> | null {
    const start = joinDateTime(startDate, startTime);
    if (!start) return null; // start date is required
    const recurrence = recurMode === "custom" ? (customRecur || null) : RECUR_PRESETS.find((p) => p.label === recurMode)?.value ?? null;
    return {
      title: title.trim() || event!.title,
      list_id: listId,
      location,
      all_day: startTime ? 0 : 1,
      start_date: start,
      end_date: joinDateTime(endDate, endTime),
      recurrence,
      notes,
      tags
    };
  }

  /** Whole-event (or whole-series) save: writes the row and reconciles reminders. */
  async function doAllSave(patch: Partial<CalendarEvent>) {
    const id = event!.id;
    onUpdate(id, patch);
    // Same batch-save diff as DetailPanel: only touch reminders that were
    // actually added or removed this session.
    const existing = await window.api.reminders?.for("event", id);
    const existingIds = new Set((existing ?? []).map((r) => r.id));
    const keptIds = new Set(reminders.filter((r) => r.id).map((r) => r.id));
    for (const r of reminders) {
      if (!r.id) await window.api.reminders?.create("event", id, r.offset_minutes);
    }
    for (const exId of existingIds) {
      if (!keptIds.has(exId)) await window.api.reminders?.delete(exId);
    }
    const refreshed = await window.api.reminders?.for("event", id);
    setReminders((refreshed ?? []).map((r) => ({ id: r.id, offset_minutes: r.offset_minutes })));
    setDirty(false);
  }

  async function handleSave() {
    const patch = buildPatch();
    if (!patch) return;
    // A specific occurrence of a recurring event was opened -> ask scope first.
    // Gated: with per-occurrence editing off, a recurring-event save applies to
    // the whole series (no prompt) — see featureFlags.RECURRING_PER_OCCURRENCE.
    if (RECURRING_PER_OCCURRENCE && event!.recurrence && occurrenceStart) {
      setScopePrompt({ mode: "save", patch });
      return;
    }
    await doAllSave(patch);
  }

  function handleDelete() {
    // Gated: with per-occurrence editing off, deleting a recurring event removes
    // the whole series (no prompt) — see featureFlags.RECURRING_PER_OCCURRENCE.
    if (RECURRING_PER_OCCURRENCE && event!.recurrence && occurrenceStart) {
      setScopePrompt({ mode: "delete" });
      return;
    }
    onDelete(event!.id);
  }

  function applyScope(scope: Scope) {
    const prompt = scopePrompt;
    setScopePrompt(null);
    if (!prompt) return;
    if (prompt.mode === "save") {
      if (scope === "all") void doAllSave(prompt.patch);
      else { onUpdateScoped(scope, event!.id, occurrenceStart!, prompt.patch); setDirty(false); }
    } else {
      if (scope === "all") onDelete(event!.id);
      else onDeleteScoped(scope, event!.id, occurrenceStart!);
    }
  }

  return (
    <div className="detail-panel event-detail-panel">
      <h3>Event details</h3>

      <label>Title</label>
      <input
        ref={titleRef}
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
              onChange={(e) => {
                const t = e.target.value;
                setStartTime(t);
                markDirty();
                // Default end to a 1-hour span the first time a start time is
                // set -- only fills a still-blank end date, never overwrites
                // one already chosen.
                if (t && startDate && !endDate) {
                  const end = addOneHour(startDate, t);
                  setEndDate(end.date);
                  setEndTime(end.time);
                }
              }} />
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

      <label>Repeats</label>
      <select
        value={recurMode}
        onChange={(e) => { setRecurMode(e.target.value); markDirty(); }}
      >
        {RECUR_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        <option value="custom">Custom RRULE…</option>
      </select>
      {recurMode === "custom" && (
        <input
          type="text"
          placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
          value={customRecur}
          onChange={(e) => { setCustomRecur(e.target.value); markDirty(); }}
        />
      )}
      {event.recurrence && (
        <p className="event-readonly-note">
          {RECURRING_PER_OCCURRENCE && occurrenceStart
            ? "This is a repeating event — saving or deleting will ask whether to apply to this occurrence, this and following, or the whole series."
            : "This is a repeating event. Saving or deleting applies to the whole series."}
        </p>
      )}

      <RemindersEditor reminders={reminders} onChange={setRemindersDirty} anchorLabel="starts" />

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
        <button className="danger" onClick={handleDelete}>Delete</button>
      </div>
      {event.caldav_uid && <div style={{ marginTop: 10, fontSize: 11, color: "#777" }}>Synced via CalDAV</div>}

      {scopePrompt && (
        <div className="overlay" onClick={() => setScopePrompt(null)}>
          <div className="settings-modal" style={{ width: 380, maxHeight: "none" }} onClick={(e) => e.stopPropagation()}>
            <h2>{scopePrompt.mode === "delete" ? "Delete repeating event" : "Save repeating event"}</h2>
            <p style={{ color: "#9aa0a6", fontSize: 13, marginTop: 0 }}>
              {scopePrompt.mode === "delete" ? "Delete which events?" : "Apply your changes to which events?"}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <button className="primary" onClick={() => applyScope("this")}>This event only</button>
              <button onClick={() => applyScope("following")}>This and following events</button>
              <button onClick={() => applyScope("all")}>All events in the series</button>
              <button style={{ marginTop: 4 }} onClick={() => setScopePrompt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
