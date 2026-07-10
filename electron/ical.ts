import ICAL from "ical.js";
import { nanoid } from "nanoid";
import type { Task, CalendarEvent } from "./db.js";

// iCal PRIORITY scale: 0 = undefined, 1-4 = high, 5 = medium, 6-9 = low.
// We store priority on the task as 0 (none), 1 (high), 5 (medium), 9 (low).

/** Adds one VALARM sub-component per reminder offset. `offsetsMinutes`
 *  entries are "minutes before" (0 = at time of). `related` forces the
 *  TRIGGER's RELATED parameter -- VTODO needs "END" since its default
 *  trigger relation is DTSTART, but this app's reminders are always
 *  due-date-anchored; VEVENT needs no param since START (== start_date) is
 *  already the default. */
function addAlarms(comp: ICAL.Component, offsetsMinutes: number[], related?: "START" | "END") {
  for (const minutes of offsetsMinutes) {
    const valarm = new ICAL.Component("valarm");
    valarm.updatePropertyWithValue("action", "DISPLAY");
    valarm.updatePropertyWithValue("description", "Reminder");
    const dur = ICAL.Duration.fromSeconds(-minutes * 60);
    const triggerProp = valarm.updatePropertyWithValue("trigger", dur);
    if (related) triggerProp.setParameter("related", related);
    comp.addSubcomponent(valarm);
  }
}

/** Reads VALARM triggers back into "minutes before" offsets. Only relative
 *  (duration) triggers that are zero or negative (i.e. at-or-before the
 *  anchor) map onto this app's reminder model; absolute date-time triggers
 *  and positive/"after" durations are out of scope and skipped. */
function extractReminderOffsets(parent: ICAL.Component): number[] {
  const offsets: number[] = [];
  for (const valarm of parent.getAllSubcomponents("valarm")) {
    const trigger = valarm.getFirstProperty("trigger");
    if (!trigger) continue;
    const val = trigger.getFirstValue();
    if (!(val instanceof ICAL.Duration)) continue; // absolute date-time trigger -- skip
    const seconds = val.toSeconds();
    if (seconds <= 0) offsets.push(Math.round(-seconds / 60));
  }
  return offsets;
}

export function taskToVTodo(
  task: Task,
  existingUid?: string,
  reminderOffsets: number[] = []
): { uid: string; ics: string } {
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
  vtodo.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(task.updated_at), true));
  vtodo.updatePropertyWithValue("sequence", task.sequence ?? 0);

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
  addAlarms(vtodo, reminderOffsets, "END");

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
  reminderOffsets: number[];
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
      updated_at: dtstamp ? dtstamp.toJSDate().toISOString() : new Date().toISOString(),
      reminderOffsets: extractReminderOffsets(vtodo)
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

export interface ParsedVEvent {
  uid: string;
  title: string;
  notes: string;
  location: string;
  start_date: string;
  end_date: string | null;
  all_day: 0 | 1;
  recurrence: string | null;
  tags: string;
  reminderOffsets: number[];
}

/** Builds an iCalendar VEVENT string from a local event, for pushing to
 *  CalDAV. Mirrors `taskToVTodo`. The push phase in caldav.ts only calls this
 *  for non-recurring events -- events with an RRULE stay read-only for now
 *  (see docs/roadmap.md "Recurring event editing"), but RRULE is still
 *  round-tripped here in case that changes. */
export function eventToVEvent(
  event: CalendarEvent,
  existingUid?: string,
  reminderOffsets: number[] = []
): { uid: string; ics: string } {
  const uid = existingUid || event.caldav_uid || `${event.id}@tasks-desktop`;
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.updatePropertyWithValue("prodid", "-//Tasks Desktop//EN");
  comp.updatePropertyWithValue("version", "2.0");

  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("summary", event.title);
  if (event.notes) vevent.updatePropertyWithValue("description", event.notes);
  if (event.location) vevent.updatePropertyWithValue("location", event.location);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(event.updated_at), true));
  vevent.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(event.updated_at), true));
  vevent.updatePropertyWithValue("sequence", event.sequence ?? 0);
  vevent.updatePropertyWithValue("dtstart", dateStringToIcalTime(event.start_date));
  if (event.end_date) {
    vevent.updatePropertyWithValue("dtend", dateStringToIcalTime(event.end_date));
  }
  if (event.recurrence) {
    try {
      vevent.updatePropertyWithValue("rrule", ICAL.Recur.fromString(event.recurrence));
    } catch {
      // ignore malformed rrule
    }
  }
  const tags = (event.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length) {
    const catProp = new ICAL.Property("categories");
    catProp.setValues(tags);
    vevent.addProperty(catProp);
  }
  addAlarms(vevent, reminderOffsets);

  comp.addSubcomponent(vevent);
  return { uid, ics: comp.toString() };
}

/** Parses a VEVENT. Ignores VEVENTs with no DTSTART, which aren't
 *  meaningfully placeable on a calendar grid. */
export function parseVEvent(ics: string): ParsedVEvent | null {
  try {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const uid = vevent.getFirstPropertyValue("uid") as string;
    const title = (vevent.getFirstPropertyValue("summary") as string) || "Untitled";
    const notes = (vevent.getFirstPropertyValue("description") as string) || "";
    const location = (vevent.getFirstPropertyValue("location") as string) || "";

    const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
    if (!dtstart) return null;
    const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time | null;

    const rruleProp = vevent.getFirstProperty("rrule");
    const recurrence = rruleProp ? (rruleProp.getFirstValue() as ICAL.Recur).toString() : null;

    const categories = vevent.getFirstProperty("categories");
    const tags = categories ? (categories.getValues() as string[]).join(", ") : "";

    return {
      uid,
      title,
      notes,
      location,
      start_date: icalTimeToString(dtstart),
      end_date: dtend ? icalTimeToString(dtend) : null,
      all_day: dtstart.isDate ? 1 : 0,
      recurrence,
      tags,
      reminderOffsets: extractReminderOffsets(vevent)
    };
  } catch (err) {
    console.error("Failed to parse VEVENT", err);
    return null;
  }
}
