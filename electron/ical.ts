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

/** Shift a date-only "YYYY-MM-DD" by whole days (UTC-anchored, so no DST/offset
 *  drift). Used to convert between iCalendar's EXCLUSIVE all-day DTEND and the
 *  INCLUSIVE last-day convention the app stores/edits/renders internally. */
function shiftDateOnly(dateStr: string, days: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** DTEND to write for a stored INCLUSIVE end. All-day ends (date-only) are the
 *  last day the event covers; iCalendar's DTEND is EXCLUSIVE, so emit the day
 *  after. Timed ends are exact instants and pass through unchanged. */
function endDateToIcalTime(endDate: string): ICAL.Time {
  return dateStringToIcalTime(endDate.length <= 10 ? shiftDateOnly(endDate, 1) : endDate);
}

/** Inverse of endDateToIcalTime: turn a parsed DTEND into the stored value.
 *  All-day (isDate) DTEND is exclusive on the wire, so store the inclusive last
 *  day (one day earlier). Timed ends pass through. */
function icalDtendToString(t: ICAL.Time): string {
  const s = icalTimeToString(t);
  return t.isDate ? shiftDateOnly(s, -1) : s;
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

export interface EventOverride {
  /** The ORIGINAL occurrence start this override replaces (its RECURRENCE-ID),
   *  in the same string format as start_date (date-only or ISO datetime). */
  recurrence_id: string;
  title?: string;
  notes?: string;
  location?: string;
  start_date: string;
  end_date: string | null;
  all_day: 0 | 1;
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
  /** Occurrence dates removed from the series (EXDATE), same format as start_date. */
  exdates: string[];
  /** Per-occurrence overrides (VEVENTs carrying a RECURRENCE-ID). */
  overrides: EventOverride[];
}

/** Builds an iCalendar VEVENT string from a local event, for pushing to
 *  CalDAV. Mirrors `taskToVTodo`. For a recurring master, `exdates` (removed
 *  occurrences) are emitted as EXDATE lines and `overrides` (per-occurrence
 *  edits) as extra VEVENTs sharing the UID with a RECURRENCE-ID. */
export function eventToVEvent(
  event: CalendarEvent,
  existingUid?: string,
  reminderOffsets: number[] = [],
  exdates: string[] = [],
  overrides: EventOverride[] = []
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
    vevent.updatePropertyWithValue("dtend", endDateToIcalTime(event.end_date));
  }
  if (event.recurrence) {
    try {
      vevent.updatePropertyWithValue("rrule", ICAL.Recur.fromString(event.recurrence));
    } catch {
      // ignore malformed rrule
    }
    // Occurrences the user removed from the series ("skip this day"). One
    // EXDATE per value keeps date-only vs date-time typing unambiguous.
    for (const ex of exdates) {
      vevent.addPropertyWithValue("exdate", dateStringToIcalTime(ex));
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

  // Per-occurrence overrides: one extra VEVENT per modified occurrence, sharing
  // the master UID and carrying a RECURRENCE-ID identifying which occurrence it
  // replaces. Only meaningful for a recurring master.
  if (event.recurrence) {
    for (const ov of overrides) {
      const ex = new ICAL.Component("vevent");
      ex.updatePropertyWithValue("uid", uid);
      ex.updatePropertyWithValue("recurrence-id", dateStringToIcalTime(ov.recurrence_id));
      ex.updatePropertyWithValue("summary", ov.title ?? event.title);
      const notes = ov.notes ?? event.notes;
      if (notes) ex.updatePropertyWithValue("description", notes);
      const location = ov.location ?? event.location;
      if (location) ex.updatePropertyWithValue("location", location);
      ex.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(event.updated_at), true));
      ex.updatePropertyWithValue("sequence", event.sequence ?? 0);
      ex.updatePropertyWithValue("dtstart", dateStringToIcalTime(ov.start_date));
      if (ov.end_date) {
        ex.updatePropertyWithValue("dtend", endDateToIcalTime(ov.end_date));
      }
      comp.addSubcomponent(ex);
    }
  }

  return { uid, ics: comp.toString() };
}

/** Parses a VEVENT resource. A resource may hold a master VEVENT plus one
 *  VEVENT per overridden occurrence (same UID, distinct RECURRENCE-ID); the
 *  master is the one without a RECURRENCE-ID. Returns null if there's no
 *  placeable master (no DTSTART). */
export function parseVEvent(ics: string): ParsedVEvent | null {
  try {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");
    if (!vevents.length) return null;

    // The master is the VEVENT with no RECURRENCE-ID; the rest are
    // per-occurrence exception overrides sharing its UID.
    const master = vevents.find((v) => !v.getFirstProperty("recurrence-id")) || null;
    if (!master) return null;

    const dtstart = master.getFirstPropertyValue("dtstart") as ICAL.Time | null;
    if (!dtstart) return null;
    const dtend = master.getFirstPropertyValue("dtend") as ICAL.Time | null;

    const uid = master.getFirstPropertyValue("uid") as string;
    const title = (master.getFirstPropertyValue("summary") as string) || "Untitled";
    const notes = (master.getFirstPropertyValue("description") as string) || "";
    const location = (master.getFirstPropertyValue("location") as string) || "";

    const rruleProp = master.getFirstProperty("rrule");
    const recurrence = rruleProp ? (rruleProp.getFirstValue() as ICAL.Recur).toString() : null;

    const categories = master.getFirstProperty("categories");
    const tags = categories ? (categories.getValues() as string[]).join(", ") : "";

    // EXDATE(s): each property may carry one or more values.
    const exdates: string[] = [];
    for (const p of master.getAllProperties("exdate")) {
      for (const v of p.getValues()) {
        if (v instanceof ICAL.Time) exdates.push(icalTimeToString(v));
      }
    }

    // Exception overrides (VEVENTs with a RECURRENCE-ID).
    const overrides: EventOverride[] = [];
    for (const v of vevents) {
      const rid = v.getFirstPropertyValue("recurrence-id") as ICAL.Time | null;
      if (!rid) continue;
      const ovStart = v.getFirstPropertyValue("dtstart") as ICAL.Time | null;
      if (!ovStart) continue;
      const ovEnd = v.getFirstPropertyValue("dtend") as ICAL.Time | null;
      overrides.push({
        recurrence_id: icalTimeToString(rid),
        title: (v.getFirstPropertyValue("summary") as string) || title,
        notes: (v.getFirstPropertyValue("description") as string) || "",
        location: (v.getFirstPropertyValue("location") as string) || "",
        start_date: icalTimeToString(ovStart),
        end_date: ovEnd ? icalDtendToString(ovEnd) : null,
        all_day: ovStart.isDate ? 1 : 0
      });
    }

    return {
      uid,
      title,
      notes,
      location,
      start_date: icalTimeToString(dtstart),
      end_date: dtend ? icalDtendToString(dtend) : null,
      all_day: dtstart.isDate ? 1 : 0,
      recurrence,
      tags,
      reminderOffsets: extractReminderOffsets(master),
      exdates,
      overrides
    };
  } catch (err) {
    console.error("Failed to parse VEVENT", err);
    return null;
  }
}
