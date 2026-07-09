import { useState } from "react";

export interface PendingReminder {
  /** null = added locally this edit session, not yet persisted. Real id = already in the DB. */
  id: string | null;
  offset_minutes: number;
}

interface Props {
  reminders: PendingReminder[];
  onChange: (next: PendingReminder[]) => void;
  /** "due" for tasks, "starts" for events -- used in the "At time of ___" label. */
  anchorLabel: string;
}

type Unit = "minutes" | "hours" | "days";

function reminderLabel(offsetMinutes: number, anchorLabel: string): string {
  if (offsetMinutes === 0) return `At time of ${anchorLabel}`;
  if (offsetMinutes % (24 * 60) === 0) {
    const d = offsetMinutes / (24 * 60);
    return `${d} day${d === 1 ? "" : "s"} before`;
  }
  if (offsetMinutes % 60 === 0) {
    const h = offsetMinutes / 60;
    return `${h} hour${h === 1 ? "" : "s"} before`;
  }
  return `${offsetMinutes} minute${offsetMinutes === 1 ? "" : "s"} before`;
}

function toMinutes(value: number, unit: Unit): number {
  if (unit === "days") return value * 24 * 60;
  if (unit === "hours") return value * 60;
  return value;
}

/** Multiple configurable reminders per task/event -- local-only (not synced
 *  via CalDAV VALARM, see docs/roadmap.md for why). Purely a controlled list
 *  editor: changes only exist in `reminders` (parent state) until the parent
 *  panel's Save button commits them, same as every other field in the
 *  detail panel -- one save model for the whole form. */
export default function RemindersEditor({ reminders, onChange, anchorLabel }: Props) {
  const [unit, setUnit] = useState<Unit>("minutes");
  const [value, setValue] = useState(15);

  function addAtTimeOf() {
    if (reminders.some((r) => r.offset_minutes === 0)) return;
    onChange([...reminders, { id: null, offset_minutes: 0 }]);
  }

  function addBefore() {
    if (!value || value <= 0) return;
    const minutes = toMinutes(value, unit);
    if (reminders.some((r) => r.offset_minutes === minutes)) return;
    onChange([...reminders, { id: null, offset_minutes: minutes }]);
  }

  function removeAt(index: number) {
    onChange(reminders.filter((_, i) => i !== index));
  }

  return (
    <div className="reminders-editor">
      <label>Reminders</label>
      <div className="reminder-chips">
        {reminders.length === 0 && <span className="reminder-empty">No reminders</span>}
        {reminders.map((r, i) => (
          <span key={i} className="reminder-chip">
            {reminderLabel(r.offset_minutes, anchorLabel)}
            <button onClick={() => removeAt(i)} title="Remove reminder">×</button>
          </span>
        ))}
      </div>
      <div className="reminder-add-row">
        <button onClick={addAtTimeOf} disabled={reminders.some((r) => r.offset_minutes === 0)}>
          At time of {anchorLabel}
        </button>
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="reminder-add-value"
        />
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="minutes">minutes before</option>
          <option value="hours">hours before</option>
          <option value="days">days before</option>
        </select>
        <button onClick={addBefore}>Add</button>
      </div>
    </div>
  );
}
