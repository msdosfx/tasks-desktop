import ICAL from "ical.js";
import { nanoid } from "nanoid";
import type { Task } from "./db.js";

// iCal PRIORITY scale: 0 = undefined, 1-4 = high, 5 = medium, 6-9 = low.
// We store priority on the task as 0 (none), 1 (high), 5 (medium), 9 (low).

export function taskToVTodo(task: Task, existingUid?: string): { uid: string; ics: string } {
  const uid = existingUid || task.caldav_uid || `${task.id}@tasks-desktop`;
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.updatePropertyWithValue("prodid", "-//Tasks Desktop//EN");
  comp.updatePropertyWithValue("version", "2.0");

  const vtodo = new ICAL.Component("vtodo");
  vtodo.updatePropertyWithValue("uid", uid);
  vtodo.updatePropertyWithValue("summary", task.title);
  if (task.notes) vtodo.updatePropertyWithValue("description", task.notes);
  vtodo.updatePropertyWithValue("priority", task.priority || 0);
  vtodo.updatePropertyWithValue("status", task.completed ? "COMPLETED" : "NEEDS-ACTION");
  vtodo.updatePropertyWithValue("percent-complete", task.completed ? 100 : 0);
  vtodo.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(task.updated_at), true));

  if (task.due_date) {
    vtodo.updatePropertyWithValue("due", dateStringToIcalTime(task.due_date));
  }
  if (task.start_date) {
    vtodo.updatePropertyWithValue("dtstart", dateStringToIcalTime(task.start_date));
  }
  if (task.completed_at) {
    vtodo.updatePropertyWithValue("completed", ICAL.Time.fromJSDate(new Date(task.completed_at), true));
  }
  if (task.recurrence) {
    try {
      vtodo.updatePropertyWithValue("rrule", ICAL.Recur.fromString(task.recurrence));
    } catch {
      // ignore malformed rrule
    }
  }
  const tags = (task.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length) {
    const catProp = new ICAL.Property("categories");
    catProp.setValues(tags);
    vtodo.addProperty(catProp);
  }
  if (task.parent_id) {
    vtodo.updatePropertyWithValue("related-to", task.parent_id);
  }

  comp.addSubcomponent(vtodo);
  return { uid, ics: comp.toString() };
}

function dateStringToIcalTime(dateStr: string): ICAL.Time {
  const isDateOnly = dateStr.length <= 10; // "YYYY-MM-DD"
  const d = new Date(dateStr);
  if (isDateOnly) {
    return new ICAL.Time(
      {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        isDate: true
      },
      ICAL.Timezone.utcTimezone
    );
  }
  return ICAL.Time.fromJSDate(d, true);
}

export interface ParsedVTodo {
  uid: string;
  title: string;
  notes: string;
  due_date: string | null;
  start_date: string | null;
  priority: 0 | 1 | 5 | 9;
  completed: 0 | 1;
  completed_at: string | null;
  recurrence: string | null;
  tags: string;
  updated_at: string;
}

export function parseVTodo(ics: string): ParsedVTodo | null {
  try {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vtodo = comp.getFirstSubcomponent("vtodo");
    if (!vtodo) return null;

    const uid = vtodo.getFirstPropertyValue("uid") as string;
    const title = (vtodo.getFirstPropertyValue("summary") as string) || "Untitled";
    const notes = (vtodo.getFirstPropertyValue("description") as string) || "";
    const status = (vtodo.getFirstPropertyValue("status") as string) || "NEEDS-ACTION";
    const completed = status === "COMPLETED" ? 1 : 0;
    const rawPriority = (vtodo.getFirstPropertyValue("priority") as unknown as number) || 0;
    const priority = normalizePriority(rawPriority);

    const due = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
    const dtstart = vtodo.getFirstPropertyValue("dtstart") as ICAL.Time | null;
    const completedAt = vtodo.getFirstPropertyValue("completed") as ICAL.Time | null;
    const dtstamp = vtodo.getFirstPropertyValue("dtstamp") as ICAL.Time | null;

    const rruleProp = vtodo.getFirstProperty("rrule");
    const recurrence = rruleProp ? (rruleProp.getFirstValue() as ICAL.Recur).toString() : null;

    const categories = vtodo.getFirstProperty("categories");
    const tags = categories ? (categories.getValues() as string[]).join(", ") : "";

    return {
      uid,
      title,
      notes,
      due_date: due ? icalTimeToString(due) : null,
      start_date: dtstart ? icalTimeToString(dtstart) : null,
      priority,
      completed: completed as 0 | 1,
      completed_at: completedAt ? completedAt.toJSDate().toISOString() : null,
      recurrence,
      tags,
      updated_at: dtstamp ? dtstamp.toJSDate().toISOString() : new Date().toISOString()
    };
  } catch (err) {
    console.error("Failed to parse VTODO", err);
    return null;
  }
}

function icalTimeToString(t: ICAL.Time): string {
  const jsDate = t.toJSDate();
  if (t.isDate) {
    return jsDate.toISOString().slice(0, 10);
  }
  return jsDate.toISOString();
}

function normalizePriority(p: number): 0 | 1 | 5 | 9 {
  if (!p) return 0;
  if (p <= 4) return 1;
  if (p === 5) return 5;
  return 9;
}

export function newUid(): string {
  return `${nanoid()}@tasks-desktop`;
}
