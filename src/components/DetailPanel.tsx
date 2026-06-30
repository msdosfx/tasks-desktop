import React, { useEffect, useState } from "react";
import { Task, TaskList, PRIORITY_LABELS } from "../types";

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

function toInputDate(v: string | null): string {
  if (!v) return "";
  return v.length >= 10 ? v.slice(0, 10) : v;
}

export default function DetailPanel({ task, lists, subtasks, allCategories = [], onUpdate, onDelete, onAddSubtask, onToggleComplete, onSelectTask }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [listId, setListId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState(0);
  const [recurMode, setRecurMode] = useState<string>("custom");
  const [customRecur, setCustomRecur] = useState("");
  const [tags, setTags] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setListId(task?.list_id ?? "");
    setStartDate(toInputDate(task?.start_date ?? null));
    setDueDate(toInputDate(task?.due_date ?? null));
    setPriority(task?.priority ?? 0);
    setTags(task?.tags ?? "");
    const preset = RECUR_PRESETS.find((p) => p.value === (task?.recurrence ?? null));
    setRecurMode(preset ? preset.label : task?.recurrence ? "custom" : RECUR_PRESETS[0].label);
    setCustomRecur(task?.recurrence ?? "");
    setDirty(false);
  }, [task?.id]);

  if (!task) {
    return <div className="detail-panel"><div className="no-selection">Select a task to see details.</div></div>;
  }

  function markDirty() {
    setDirty(true);
  }

  function handleSave() {
    const recurrence = recurMode === "custom" ? (customRecur || null) : RECUR_PRESETS.find((p) => p.label === recurMode)?.value ?? null;
    onUpdate(task!.id, {
      title: title.trim() || task!.title,
      notes,
      list_id: listId,
      start_date: startDate || null,
      due_date: dueDate || null,
      priority: priority as any,
      recurrence,
      tags
    });
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
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); markDirty(); }} />
        </div>
        <div>
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); markDirty(); }} />
        </div>
      </div>

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
          <div className="add-subtask">
            <input
              type="text"
              placeholder="Add subtask and press Enter"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubtask.trim()) {
                  onAddSubtask(task.id, newSubtask.trim());
                  setNewSubtask("");
                }
              }}
            />
            <button onClick={() => { if (newSubtask.trim()) { onAddSubtask(task.id, newSubtask.trim()); setNewSubtask(""); } }}>Add</button>
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
