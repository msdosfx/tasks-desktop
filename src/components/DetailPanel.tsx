import React, { useEffect, useState } from "react";
import { Task, TaskList, PRIORITY_LABELS } from "../types";
import RemindersEditor, { PendingReminder } from "./RemindersEditor";

interface Props {
  task: Task | null;
  lists: TaskList[];
  subtasks: Task[];
  allCategories?: string[];
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string, title: string) => void;
  onToggleComplete: (id: string) => void;
  onSelectTask: (id: string) => void;
}

const RECUR_PRESETS: { label: string; value: string | null }[] = [
  { label: "Does not repeat", value: null },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Monthly", value: "FREQ=MONTHLY" },
  { label: "Yearly", value: "FREQ=YEARLY" }
];

/** Splits a stored value ("YYYY-MM-DD" or full ISO datetime) into local-time
 *  date and time input values. Time is "" for date-only tasks. */
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

/** Date-only stays a plain "YYYY-MM-DD" (synced as an iCal DATE); with a time
 *  it becomes a full ISO datetime (synced as DATE-TIME), matching Tasks.org's
 *  optional due/start times. */
function joinDateTime(date: string, time: string): string | null {
  if (!date) return null;
  if (!time) return date;
  return new Date(`${date}T${time}`).toISOString();
}

/** One hour after a local date+time, split back into date/time input values
 *  -- used to default the due date/time when a start time is set and due
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

export default function DetailPanel({ task, lists, subtasks, allCategories = [], onUpdate, onDelete, onAddSubtask, onToggleComplete, onSelectTask }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [listId, setListId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState(0);
  const [recurMode, setRecurMode] = useState<string>("custom");
  const [customRecur, setCustomRecur] = useState("");
  const [tags, setTags] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  // New subtask titles typed this edit session, not yet created -- committed
  // on Save along with everything else in this panel (one save model for the
  // whole form, matching Thunderbird/Tasks.org rather than auto-saving each
  // field independently).
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [reminders, setReminders] = useState<PendingReminder[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setListId(task?.list_id ?? "");
    const sd = splitDateTime(task?.start_date ?? null);
    setStartDate(sd.date); setStartTime(sd.time);
    const dd = splitDateTime(task?.due_date ?? null);
    setDueDate(dd.date); setDueTime(dd.time);
    setPriority(task?.priority ?? 0);
    setTags(task?.tags ?? "");
    const preset = RECUR_PRESETS.find((p) => p.value === (task?.recurrence ?? null));
    setRecurMode(preset ? preset.label : task?.recurrence ? "custom" : RECUR_PRESETS[0].label);
    setCustomRecur(task?.recurrence ?? "");
    setPendingSubtasks([]);
    setDirty(false);
    if (task?.id) {
      window.api.reminders?.for("task", task.id).then((rs) => {
        setReminders(rs.map((r) => ({ id: r.id, offset_minutes: r.offset_minutes })));
      });
    } else {
      setReminders([]);
    }
  }, [task?.id]);

  if (!task) {
    return <div className="detail-panel"><div className="no-selection">Select a task or event to see details.</div></div>;
  }

  function markDirty() {
    setDirty(true);
  }

  function setRemindersDirty(next: PendingReminder[]) {
    setReminders(next);
    markDirty();
  }

  async function handleSave() {
    const id = task!.id;
    const recurrence = recurMode === "custom" ? (customRecur || null) : RECUR_PRESETS.find((p) => p.label === recurMode)?.value ?? null;
    onUpdate(id, {
      title: title.trim() || task!.title,
      notes,
      list_id: listId,
      start_date: joinDateTime(startDate, startTime),
      due_date: joinDateTime(dueDate, dueTime),
      priority: priority as any,
      recurrence,
      tags
    });
    for (const t of pendingSubtasks) onAddSubtask(id, t);
    // Diff against what's already in the DB: anything without a real id is
    // new (create it); anything that dropped out of the working list but
    // still has a real id was removed (delete it). Untouched existing
    // reminders need no call at all.
    const existing = await window.api.reminders?.for("task", id);
    const existingIds = new Set((existing ?? []).map((r) => r.id));
    const keptIds = new Set(reminders.filter((r) => r.id).map((r) => r.id));
    for (const r of reminders) {
      if (!r.id) await window.api.reminders?.create("task", id, r.offset_minutes);
    }
    for (const exId of existingIds) {
      if (!keptIds.has(exId)) await window.api.reminders?.delete(exId);
    }
    const refreshed = await window.api.reminders?.for("task", id);
    setReminders((refreshed ?? []).map((r) => ({ id: r.id, offset_minutes: r.offset_minutes })));
    setPendingSubtasks([]);
    setDirty(false);
  }

  return (
    <div className="detail-panel">
      <h3>Task details</h3>

      <label>Title</label>
      <input
        type="text"
        value={title}
        onChange={(e) => { setTitle(e.target.value); markDirty(); }}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
      />

      <label>Notes</label>
      <textarea value={notes} onChange={(e) => { setNotes(e.target.value); markDirty(); }} />

      <label>List</label>
      <select value={listId} onChange={(e) => { setListId(e.target.value); markDirty(); }}>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>

      <div className="detail-row">
        <div>
          <label>Start date</label>
          <div className="date-time-pair">
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!e.target.value) setStartTime(""); markDirty(); }} />
            <input type="time" value={startTime} disabled={!startDate} title={startDate ? "Optional time" : "Set a date first"}
              onChange={(e) => {
                const t = e.target.value;
                setStartTime(t);
                markDirty();
                // Default due to a 1-hour span the first time a start time is
                // set -- only fills a still-blank due date, never overwrites
                // one already chosen.
                if (t && startDate && !dueDate) {
                  const end = addOneHour(startDate, t);
                  setDueDate(end.date);
                  setDueTime(end.time);
                }
              }} />
          </div>
        </div>
        <div>
          <label>Due date</label>
          <div className="date-time-pair">
            <input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); if (!e.target.value) setDueTime(""); markDirty(); }} />
            <input type="time" value={dueTime} disabled={!dueDate} title={dueDate ? "Optional time" : "Set a date first"}
              onChange={(e) => { setDueTime(e.target.value); markDirty(); }} />
          </div>
        </div>
      </div>

      {dueDate && <RemindersEditor reminders={reminders} onChange={setRemindersDirty} anchorLabel="due" />}

      <div className="detail-row">
        <div>
          <label>Priority</label>
          <select value={priority} onChange={(e) => { setPriority(Number(e.target.value)); markDirty(); }}>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label>Repeat</label>
          <select
            value={recurMode}
            onChange={(e) => { setRecurMode(e.target.value); markDirty(); }}
          >
            {RECUR_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            <option value="custom">Custom RRULE…</option>
          </select>
        </div>
      </div>

      {recurMode === "custom" && (
        <>
          <label>Custom RRULE</label>
          <input
            type="text"
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
            value={customRecur}
            onChange={(e) => { setCustomRecur(e.target.value); markDirty(); }}
          />
        </>
      )}

      <label>Categories</label>
      <datalist id="category-suggestions">
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
          list="category-suggestions"
          className="category-add-input"
          placeholder="Add category…"
          onChange={(e) => {
            // Auto-commit when the user picks an existing suggestion from the datalist
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

      {!task.parent_id && (
        <div className="subtasks">
          <label>Subtasks</label>
          {subtasks.map((s) => (
            <div className="subtask-item" key={s.id}>
              <span className={`checkbox ${s.completed ? "done" : ""}`} onClick={() => onToggleComplete(s.id)} style={{ marginTop: 0 }} />
              <span style={{ flex: 1, textDecoration: s.completed ? "line-through" : "none", color: s.completed ? "#777" : "inherit", cursor: "pointer" }}
                onClick={() => onSelectTask(s.id)}>
                {s.title}
              </span>
            </div>
          ))}
          {pendingSubtasks.map((t, i) => (
            <div className="subtask-item" key={`pending-${i}`}>
              <span className="checkbox" style={{ marginTop: 0, opacity: 0.4 }} title="Not saved yet" />
              <span style={{ flex: 1, fontStyle: "italic", color: "#9aa0a6" }}>{t}</span>
              <button
                className="smart-filter-delete"
                title="Remove (not yet saved)"
                onClick={() => setPendingSubtasks(pendingSubtasks.filter((_, idx) => idx !== i))}
              >×</button>
            </div>
          ))}
          <div className="add-subtask">
            <input
              type="text"
              placeholder="Add subtask (saved with the rest on Save)"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubtask.trim()) {
                  setPendingSubtasks([...pendingSubtasks, newSubtask.trim()]);
                  setNewSubtask("");
                  markDirty();
                }
              }}
            />
            <button onClick={() => {
              if (newSubtask.trim()) {
                setPendingSubtasks([...pendingSubtasks, newSubtask.trim()]);
                setNewSubtask("");
                markDirty();
              }
            }}>Add</button>
          </div>
        </div>
      )}

      <div className="detail-actions">
        <button className="primary" onClick={handleSave} disabled={!dirty}>{dirty ? "Save" : "Saved"}</button>
        <button onClick={() => onToggleComplete(task.id)}>{task.completed ? "Mark incomplete" : "Mark complete"}</button>
        <button className="danger" onClick={() => onDelete(task.id)}>Delete</button>
      </div>
      {task.caldav_uid && <div style={{ marginTop: 10, fontSize: 11, color: "#777" }}>Synced via CalDAV</div>}
    </div>
  );
}
