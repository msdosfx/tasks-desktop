import { DatabaseSync } from "node:sqlite";
// Default-import + destructure: rrule's Node entry is a UMD/CJS bundle whose
// named exports aren't statically detectable by Node's ESM interop.
import rrulePkg from "rrule";
const { RRule } = rrulePkg;
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";

export interface TaskList {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  caldav_account_id: string | null;
  caldav_calendar_url: string | null;
  caldav_ctag: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string;
  due_date: string | null; // ISO date or datetime
  start_date: string | null;
  priority: 0 | 1 | 5 | 9; // 0 none, 1 high, 5 medium, 9 low (iCal scale)
  completed: 0 | 1;
  completed_at: string | null;
  recurrence: string | null; // RRULE string, no "RRULE:" prefix
  tags: string; // comma-separated
  sort_order: number;
  caldav_uid: string | null;
  caldav_href: string | null;
  caldav_etag: string | null;
  deleted: 0 | 1;
  /** 1 = has local edits not yet pushed to the CalDAV server */
  dirty: 0 | 1;
  /** When a reminder notification was last fired for the current due_date. */
  notified_at: string | null;
  /** iCal SEQUENCE -- bumped on each user-facing edit so CalDAV clients can
   *  tell a real revision from a no-op re-sync. */
  sequence: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  list_id: string;
  title: string;
  notes: string;
  location: string;
  start_date: string; // ISO date (all-day) or datetime
  end_date: string | null; // ISO date or datetime; null = same instant as start
  all_day: 0 | 1;
  recurrence: string | null; // RRULE string, no "RRULE:" prefix
  tags: string; // comma-separated
  caldav_uid: string | null;
  caldav_href: string | null;
  caldav_etag: string | null;
  deleted: 0 | 1;
  /** 1 = has local edits not yet pushed to the CalDAV server */
  dirty: 0 | 1;
  /** iCal SEQUENCE -- bumped on each user-facing edit so CalDAV clients can
   *  tell a real revision from a no-op re-sync. */
  sequence: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  owner_type: "task" | "event";
  owner_id: string;
  /** 0 = at time of due/start; >0 = minutes before. */
  offset_minutes: number;
  fired_at: string | null;
  created_at: string;
}

export interface CaldavAccount {
  id: string;
  label: string;
  server_url: string;
  username: string;
  password_enc: string; // base64 of safeStorage-encrypted bytes, or plain if encryption unavailable
  principal_url: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

export interface AddressBook {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  carddav_account_id: string | null;
  carddav_addressbook_url: string | null;
  carddav_ctag: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  address_book_id: string;
  fn: string; // formatted/display name (vCard FN)
  prefix: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  nickname: string;
  org: string;
  title: string; // job title
  bday: string | null; // "YYYY-MM-DD", or "--MM-DD" for a year-less birthday
  anniversary: string | null;
  notes: string;
  categories: string; // comma-separated labels
  photo: string; // data URI (e.g. "data:image/jpeg;base64,...") or ""
  // JSON arrays of typed values, shapes defined in vcard.ts:
  phones: string; // [{ type, value }]
  emails: string; // [{ type, value }]
  addresses: string; // [{ type, street, city, region, postal, country }]
  urls: string; // [{ type, value }]
  impps: string; // [{ type, value }]  (instant messaging / social)
  related: string; // [{ type, value }]
  /** The untouched server vCard, so properties we don't model survive a
   *  round-trip -- on push we re-emit modeled fields over this raw card. */
  raw_vcard: string;
  carddav_uid: string | null; // the vCard UID
  carddav_href: string | null;
  carddav_etag: string | null;
  deleted: 0 | 1;
  dirty: 0 | 1;
  sequence: number;
  created_at: string;
  updated_at: string;
}

function dbPath() {
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "tasks-desktop.sqlite3");
}

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath());
  _db.exec("PRAGMA journal_mode = WAL;");
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4a90d9',
      sort_order INTEGER NOT NULL DEFAULT 0,
      caldav_account_id TEXT,
      caldav_calendar_url TEXT,
      caldav_ctag TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      start_date TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      recurrence TEXT,
      tags TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      caldav_uid TEXT,
      caldav_href TEXT,
      caldav_etag TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 0,
      notified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      tags TEXT NOT NULL DEFAULT '',
      caldav_uid TEXT,
      caldav_href TEXT,
      caldav_etag TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_list ON events(list_id);
    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);

    CREATE TABLE IF NOT EXISTS caldav_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      server_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      principal_url TEXT,
      last_sync_at TEXT,
      last_sync_status TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL DEFAULT 0,
      fired_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_owner ON reminders(owner_type, owner_id);

    CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  `);

  // Contacts (CardDAV). New tables -- created on first launch after this build.
  db.exec(`
    CREATE TABLE IF NOT EXISTS address_books (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4a90d9',
      sort_order INTEGER NOT NULL DEFAULT 0,
      carddav_account_id TEXT,
      carddav_addressbook_url TEXT,
      carddav_ctag TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      address_book_id TEXT NOT NULL,
      fn TEXT NOT NULL DEFAULT '',
      prefix TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      middle_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      bday TEXT,
      anniversary TEXT,
      notes TEXT NOT NULL DEFAULT '',
      categories TEXT NOT NULL DEFAULT '',
      photo TEXT NOT NULL DEFAULT '',
      phones TEXT NOT NULL DEFAULT '[]',
      emails TEXT NOT NULL DEFAULT '[]',
      addresses TEXT NOT NULL DEFAULT '[]',
      urls TEXT NOT NULL DEFAULT '[]',
      impps TEXT NOT NULL DEFAULT '[]',
      related TEXT NOT NULL DEFAULT '[]',
      raw_vcard TEXT NOT NULL DEFAULT '',
      carddav_uid TEXT,
      carddav_href TEXT,
      carddav_etag TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 0,
      sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (address_book_id) REFERENCES address_books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_book ON contacts(address_book_id);
  `);

  // Older databases predate these columns.
  try { db.exec(`ALTER TABLE tasks ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN notified_at TEXT`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE events ADD COLUMN tags TEXT NOT NULL DEFAULT ''`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE events ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }

  // One-time (idempotent -- safe to run every launch) backfill: reminders used
  // to be implicit (every due task notified automatically via the old
  // tasks.notified_at column). Materialize that as an explicit "at time of"
  // reminder row per item, so it's editable through the same UI as any other
  // reminder, without changing default notification behavior.
  {
    const now = new Date().toISOString();
    const tasksNeedingDefault = db
      .prepare(
        `SELECT id, notified_at FROM tasks WHERE deleted = 0 AND due_date IS NOT NULL
         AND id NOT IN (SELECT owner_id FROM reminders WHERE owner_type = 'task')`
      )
      .all() as { id: string; notified_at: string | null }[];
    for (const t of tasksNeedingDefault) {
      // Preserves whether this task already fired its notification before
      // reminders existed as their own table.
      db.prepare(
        `INSERT INTO reminders (id, owner_type, owner_id, offset_minutes, fired_at, created_at) VALUES (?, 'task', ?, 0, ?, ?)`
      ).run(nanoid(), t.id, t.notified_at, now);
    }
    // Events never had reminders before this feature. Backfilled default
    // reminders are marked already-fired so existing (possibly long-past)
    // events don't suddenly send a burst of notifications; only reminders
    // created going forward (new events, or edits) are live.
    const eventsNeedingDefault = db
      .prepare(
        `SELECT id FROM events WHERE deleted = 0 AND start_date IS NOT NULL AND recurrence IS NULL
         AND id NOT IN (SELECT owner_id FROM reminders WHERE owner_type = 'event')`
      )
      .all() as { id: string }[];
    for (const e of eventsNeedingDefault) {
      db.prepare(
        `INSERT INTO reminders (id, owner_type, owner_id, offset_minutes, fired_at, created_at) VALUES (?, 'event', ?, 0, ?, ?)`
      ).run(nanoid(), e.id, now, now);
    }
  }

  const listCount = db.prepare("SELECT COUNT(*) AS c FROM lists").get() as { c: number };
  if (listCount.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO lists (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), "Tasks", "#4a90d9", 0, now, now);
  }

  // Ensure a default address book exists so new contacts always have a home
  // (link it to a CardDAV address book later to sync).
  const bookCount = db.prepare("SELECT COUNT(*) AS c FROM address_books").get() as { c: number };
  if (bookCount.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO address_books (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), "Contacts", "#4a90d9", 0, now, now);
  }
}

const nowIso = () => new Date().toISOString();

// ---------- Lists ----------
export function listsAll(): TaskList[] {
  return getDb().prepare(`SELECT * FROM lists ORDER BY sort_order ASC, name ASC`).all() as unknown as TaskList[];
}

export function listCreate(name: string, color = "#4a90d9"): TaskList {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  const maxOrder = (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM lists`).get() as any).m as number;
  db.prepare(
    `INSERT INTO lists (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, color, maxOrder + 1, now, now);
  return db.prepare(`SELECT * FROM lists WHERE id = ?`).get(id) as unknown as TaskList;
}

export function listUpdate(id: string, patch: Partial<TaskList>): TaskList {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM lists WHERE id = ?`).get(id) as unknown as TaskList;
  if (!current) throw new Error("List not found");
  const merged = { ...current, ...patch, updated_at: nowIso() };
  db.prepare(
    `UPDATE lists SET name=?, color=?, sort_order=?, caldav_account_id=?, caldav_calendar_url=?, caldav_ctag=?, updated_at=? WHERE id=?`
  ).run(
    merged.name,
    merged.color,
    merged.sort_order,
    merged.caldav_account_id,
    merged.caldav_calendar_url,
    merged.caldav_ctag,
    merged.updated_at,
    id
  );
  return db.prepare(`SELECT * FROM lists WHERE id = ?`).get(id) as unknown as TaskList;
}

export function listDelete(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM tasks WHERE list_id = ?`).run(id);
  db.prepare(`DELETE FROM lists WHERE id = ?`).run(id);
}

// ---------- Tasks ----------
export function tasksAll(): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE deleted = 0 ORDER BY sort_order ASC, created_at ASC`).all() as unknown as Task[];
}

export function tasksByList(listId: string): Task[] {
  return getDb()
    .prepare(`SELECT * FROM tasks WHERE list_id = ? AND deleted = 0 ORDER BY sort_order ASC, created_at ASC`)
    .all(listId) as unknown as Task[];
}

export function taskGet(id: string): Task | undefined {
  return getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task | undefined;
}

export function taskCreate(input: Partial<Task> & { list_id: string; title: string }): Task {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  const maxOrder = (
    db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM tasks WHERE list_id = ?`).get(input.list_id) as any
  ).m as number;
  db.prepare(
    `INSERT INTO tasks (id, list_id, parent_id, title, notes, due_date, start_date, priority, completed, completed_at, recurrence, tags, sort_order, caldav_uid, caldav_href, caldav_etag, deleted, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id,
    input.list_id,
    input.parent_id ?? null,
    input.title,
    input.notes ?? "",
    input.due_date ?? null,
    input.start_date ?? null,
    input.priority ?? 0,
    input.completed ?? 0,
    input.completed_at ?? null,
    input.recurrence ?? null,
    input.tags ?? "",
    maxOrder + 1,
    input.caldav_uid ?? null,
    input.caldav_href ?? null,
    input.caldav_etag ?? null,
    // Sync-created tasks (they arrive with a CalDAV UID) are already on the
    // server; anything else is a local creation that still needs pushing.
    input.dirty ?? (input.caldav_uid ? 0 : 1),
    now,
    now
  );
  if (input.due_date) ensureDefaultReminder("task", id);
  return taskGet(id)!;
}

export function taskUpdate(id: string, patch: Partial<Task>): Task {
  const db = getDb();
  const current = taskGet(id);
  if (!current) throw new Error("Task not found");
  // Updates that carry caldav_etag come from the sync engine (applying remote
  // state or recording a successful push) -- they leave the task clean. Any
  // other update is a user edit that must be pushed on the next sync.
  const isSyncUpdate = Object.prototype.hasOwnProperty.call(patch, "caldav_etag");
  // sort_order isn't synced to CalDAV, so reordering alone must not mark the
  // task dirty (that would re-push unchanged content and churn server etags).
  const syncIrrelevant = Object.keys(patch).every((k) => k === "sort_order");
  let dirty: 0 | 1;
  if (patch.dirty !== undefined) dirty = patch.dirty;
  else if (isSyncUpdate) dirty = 0;
  else if (syncIrrelevant) dirty = current.dirty;
  else dirty = 1;
  // Bump SEQUENCE on real content edits (not etag-only sync writes) so remote
  // CalDAV clients recognize a genuine revision.
  const sequence = dirty === 1 && !isSyncUpdate ? current.sequence + 1 : current.sequence;
  const merged: Task = { ...current, ...patch, dirty, sequence, updated_at: nowIso() };
  // A new due date (edit, snooze, recurrence advance, or a change pulled from
  // the server) gets a fresh reminder.
  if (patch.due_date !== undefined && patch.due_date !== current.due_date) merged.notified_at = null;
  db.prepare(
    `UPDATE tasks SET list_id=?, parent_id=?, title=?, notes=?, due_date=?, start_date=?,
     priority=?, completed=?, completed_at=?, recurrence=?, tags=?, sort_order=?,
     caldav_uid=?, caldav_href=?, caldav_etag=?, deleted=?, dirty=?, sequence=?, notified_at=?, updated_at=?
     WHERE id=?`
  ).run(
    merged.list_id,
    merged.parent_id,
    merged.title,
    merged.notes,
    merged.due_date,
    merged.start_date,
    merged.priority,
    merged.completed,
    merged.completed_at,
    merged.recurrence,
    merged.tags,
    merged.sort_order,
    merged.caldav_uid,
    merged.caldav_href,
    merged.caldav_etag,
    merged.deleted,
    merged.dirty,
    merged.sequence,
    merged.notified_at,
    merged.updated_at,
    id
  );
  // A due date freshly set (was null before) gets a default reminder, same as
  // a brand-new task -- but only on that specific transition, not every edit,
  // so a deliberately-deleted reminder doesn't come back.
  if (patch.due_date !== undefined && !current.due_date && merged.due_date) ensureDefaultReminder("task", id);
  return taskGet(id)!;
}

/** Next occurrence strictly after `due` per the task's RRULE, in the same
 *  format as the input (date-only stays date-only). Null when the rule is
 *  exhausted (COUNT/UNTIL) or malformed. */
function nextOccurrence(rruleStr: string, due: string): string | null {
  try {
    const dateOnly = due.length <= 10;
    const dtstart = new Date(dateOnly ? `${due}T00:00:00Z` : due);
    const rule = new RRule({ ...RRule.parseString(rruleStr), dtstart });
    const next = rule.after(dtstart, false);
    if (!next) return null;
    return dateOnly ? next.toISOString().slice(0, 10) : next.toISOString();
  } catch {
    return null;
  }
}

export function taskToggleComplete(id: string): Task {
  const t = taskGet(id);
  if (!t) throw new Error("Task not found");
  // Completing a recurring task reschedules it to the next occurrence instead
  // of completing it (Tasks.org behavior). Once the rule runs out, it
  // completes like a normal task. Un-completing is always a plain toggle.
  if (!t.completed && t.recurrence && t.due_date) {
    const next = nextOccurrence(t.recurrence, t.due_date);
    if (next) {
      const patch: Partial<Task> = { due_date: next };
      if (t.start_date) {
        // Keep the start date the same distance ahead of the new due date.
        const offset = new Date(t.due_date).getTime() - new Date(t.start_date).getTime();
        const newStart = new Date(new Date(next.length <= 10 ? `${next}T00:00:00Z` : next).getTime() - offset);
        patch.start_date = t.start_date.length <= 10 ? newStart.toISOString().slice(0, 10) : newStart.toISOString();
      }
      return taskUpdate(id, patch);
    }
  }
  const completed = t.completed ? 0 : 1;
  return taskUpdate(id, { completed, completed_at: completed ? nowIso() : null } as Partial<Task>);
}

export function taskDelete(id: string, hard = false) {
  const db = getDb();
  if (hard) {
    db.prepare(`DELETE FROM tasks WHERE id = ? OR parent_id = ?`).run(id, id);
  } else {
    db.prepare(`UPDATE tasks SET deleted = 1, updated_at = ? WHERE id = ? OR parent_id = ?`).run(nowIso(), id, id);
  }
}

export function subtasksOf(parentId: string): Task[] {
  return getDb()
    .prepare(`SELECT * FROM tasks WHERE parent_id = ? AND deleted = 0 ORDER BY sort_order ASC`)
    .all(parentId) as unknown as Task[];
}

// ---------- Events ----------
export function eventsAll(): CalendarEvent[] {
  return getDb()
    .prepare(`SELECT * FROM events WHERE deleted = 0 ORDER BY start_date ASC`)
    .all() as unknown as CalendarEvent[];
}

export function eventsByList(listId: string): CalendarEvent[] {
  return getDb()
    .prepare(`SELECT * FROM events WHERE list_id = ? AND deleted = 0 ORDER BY start_date ASC`)
    .all(listId) as unknown as CalendarEvent[];
}

export function eventGet(id: string): CalendarEvent | undefined {
  return getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(id) as unknown as CalendarEvent | undefined;
}

/** Non-recurring only -- creating a recurring event isn't supported yet
 *  (see docs/roadmap.md "Recurring event editing"). */
export function eventCreate(input: Partial<CalendarEvent> & { list_id: string; title: string; start_date: string }): CalendarEvent {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO events (id, list_id, title, notes, location, start_date, end_date, all_day, recurrence, tags, caldav_uid, caldav_href, caldav_etag, deleted, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id,
    input.list_id,
    input.title,
    input.notes ?? "",
    input.location ?? "",
    input.start_date,
    input.end_date ?? null,
    input.all_day ?? 1,
    input.recurrence ?? null,
    input.tags ?? "",
    input.caldav_uid ?? null,
    input.caldav_href ?? null,
    input.caldav_etag ?? null,
    input.dirty ?? (input.caldav_uid ? 0 : 1),
    now,
    now
  );
  // Recurring events are excluded from reminders in v1.
  if (!input.recurrence) ensureDefaultReminder("event", id);
  return eventGet(id)!;
}

export function eventUpdate(id: string, patch: Partial<CalendarEvent>): CalendarEvent {
  const db = getDb();
  const current = eventGet(id);
  if (!current) throw new Error("Event not found");
  // Same convention as taskUpdate: an update carrying caldav_etag comes from
  // the sync engine and leaves the event clean; anything else is a user edit
  // that still needs pushing.
  const isSyncUpdate = Object.prototype.hasOwnProperty.call(patch, "caldav_etag");
  let dirty: 0 | 1;
  if (patch.dirty !== undefined) dirty = patch.dirty;
  else if (isSyncUpdate) dirty = 0;
  else dirty = 1;
  // Bump SEQUENCE on real content edits (not etag-only sync writes) so remote
  // CalDAV clients recognize a genuine revision.
  const sequence = dirty === 1 && !isSyncUpdate ? current.sequence + 1 : current.sequence;
  const merged: CalendarEvent = { ...current, ...patch, dirty, sequence, updated_at: nowIso() };
  db.prepare(
    `UPDATE events SET list_id=?, title=?, notes=?, location=?, start_date=?, end_date=?, all_day=?,
     recurrence=?, tags=?, caldav_uid=?, caldav_href=?, caldav_etag=?, deleted=?, dirty=?, sequence=?, updated_at=?
     WHERE id=?`
  ).run(
    merged.list_id,
    merged.title,
    merged.notes,
    merged.location,
    merged.start_date,
    merged.end_date,
    merged.all_day,
    merged.recurrence,
    merged.tags,
    merged.caldav_uid,
    merged.caldav_href,
    merged.caldav_etag,
    merged.deleted,
    merged.dirty,
    merged.sequence,
    merged.updated_at,
    id
  );
  // Edge case reachable via CalDAV pull (not our own UI yet): a recurring
  // event's recurrence rule is removed on the server, making it eligible for
  // reminders for the first time.
  if (patch.recurrence !== undefined && current.recurrence && !merged.recurrence) ensureDefaultReminder("event", id);
  return eventGet(id)!;
}

/** Soft-deletes a local-only event outright (nothing to push); soft-deletes a
 *  synced event so the push phase can remove it from the server first. */
export function eventDelete(id: string, hard = false) {
  const db = getDb();
  if (hard) {
    db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
  } else {
    db.prepare(`UPDATE events SET deleted = 1, updated_at = ? WHERE id = ?`).run(nowIso(), id);
  }
}

/** All events (including soft-deleted) for a list, keyed by CalDAV uid — used by
 *  the sync engine to diff against what the server currently has. */
export function eventsByListWithUid(listId: string): Map<string, CalendarEvent> {
  const rows = getDb()
    .prepare(`SELECT * FROM events WHERE list_id = ?`)
    .all(listId) as unknown as CalendarEvent[];
  const map = new Map<string, CalendarEvent>();
  for (const e of rows) if (e.caldav_uid) map.set(e.caldav_uid, e);
  return map;
}

/** Applies remote content unconditionally -- used for recurring events (still
 *  read-only, so there's never a local edit to protect) and for brand-new
 *  events pulled for the first time. Non-recurring events with local edits go
 *  through `eventUpdate`/`eventCreate` in caldav.ts's etag/dirty-aware sync
 *  instead, so their `dirty` flag and any conflict copy are handled properly. */
export function eventUpsertFromRemote(
  listId: string,
  uid: string,
  href: string,
  etag: string,
  parsed: Omit<CalendarEvent, "id" | "list_id" | "caldav_uid" | "caldav_href" | "caldav_etag" | "deleted" | "dirty" | "sequence" | "created_at" | "updated_at">
): void {
  const db = getDb();
  const now = nowIso();
  const existing = db
    .prepare(`SELECT id FROM events WHERE list_id = ? AND caldav_uid = ?`)
    .get(listId, uid) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE events SET title=?, notes=?, location=?, start_date=?, end_date=?, all_day=?, recurrence=?, tags=?,
       caldav_href=?, caldav_etag=?, deleted=0, dirty=0, updated_at=? WHERE id=?`
    ).run(
      parsed.title,
      parsed.notes,
      parsed.location,
      parsed.start_date,
      parsed.end_date,
      parsed.all_day,
      parsed.recurrence,
      parsed.tags,
      href,
      etag,
      now,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO events (id, list_id, title, notes, location, start_date, end_date, all_day, recurrence, tags, caldav_uid, caldav_href, caldav_etag, deleted, dirty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
    ).run(
      nanoid(),
      listId,
      parsed.title,
      parsed.notes,
      parsed.location,
      parsed.start_date,
      parsed.end_date,
      parsed.all_day,
      parsed.recurrence,
      parsed.tags,
      uid,
      href,
      etag,
      now,
      now
    );
  }
}

/** Removes local events for this list whose uid is no longer present remotely
 *  (hard delete). Skips rows with unpushed local edits (`dirty`) so a
 *  same-round-trip remote deletion can't silently destroy in-flight edits --
 *  those get left as a local-only orphan instead, which the push phase will
 *  simply recreate as a new event on the next sync. */
export function eventsPruneMissing(listId: string, remoteUids: Set<string>) {
  const db = getDb();
  const local = db.prepare(`SELECT id, caldav_uid, dirty FROM events WHERE list_id = ?`).all(listId) as { id: string; caldav_uid: string | null; dirty: 0 | 1 }[];
  for (const row of local) {
    if (row.caldav_uid && !remoteUids.has(row.caldav_uid) && !row.dirty) {
      db.prepare(`DELETE FROM events WHERE id = ?`).run(row.id);
    }
  }
}

// ---------- CalDAV accounts ----------
export function accountsAll(): CaldavAccount[] {
  return getDb().prepare(`SELECT * FROM caldav_accounts ORDER BY created_at ASC`).all() as unknown as CaldavAccount[];
}

export function accountCreate(input: Omit<CaldavAccount, "id" | "created_at" | "last_sync_at" | "last_sync_status">): CaldavAccount {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO caldav_accounts (id, label, server_url, username, password_enc, principal_url, last_sync_at, last_sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(id, input.label, input.server_url, input.username, input.password_enc, input.principal_url ?? null, now);
  return db.prepare(`SELECT * FROM caldav_accounts WHERE id = ?`).get(id) as unknown as CaldavAccount;
}

export function accountUpdate(id: string, patch: Partial<CaldavAccount>): CaldavAccount {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM caldav_accounts WHERE id = ?`).get(id) as unknown as CaldavAccount;
  const merged = { ...current, ...patch };
  db.prepare(
    `UPDATE caldav_accounts SET label=?, server_url=?, username=?, password_enc=?, principal_url=?, last_sync_at=?, last_sync_status=? WHERE id=?`
  ).run(
    merged.label,
    merged.server_url,
    merged.username,
    merged.password_enc,
    merged.principal_url,
    merged.last_sync_at,
    merged.last_sync_status,
    id
  );
  return db.prepare(`SELECT * FROM caldav_accounts WHERE id = ?`).get(id) as unknown as CaldavAccount;
}

export function accountDelete(id: string) {
  const db = getDb();
  db.prepare(`UPDATE lists SET caldav_account_id = NULL, caldav_calendar_url = NULL, caldav_ctag = NULL WHERE caldav_account_id = ?`).run(id);
  db.prepare(`DELETE FROM caldav_accounts WHERE id = ?`).run(id);
}

// ---------- Settings ----------
export function settingsAll(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function settingSet(key: string, value: string) {
  getDb().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// ---------- Reminders ----------
/** All configured reminders for a task or event, soonest-before-due first
 *  (offset_minutes ascending -- 0 = "at time of" sorts first). */
export function remindersForOwner(ownerType: "task" | "event", ownerId: string): Reminder[] {
  return getDb()
    .prepare(`SELECT * FROM reminders WHERE owner_type = ? AND owner_id = ? ORDER BY offset_minutes ASC`)
    .all(ownerType, ownerId) as unknown as Reminder[];
}

export function reminderCreate(ownerType: "task" | "event", ownerId: string, offsetMinutes: number): Reminder {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO reminders (id, owner_type, owner_id, offset_minutes, fired_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(id, ownerType, ownerId, offsetMinutes, now);
  return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as unknown as Reminder;
}

export function reminderDelete(id: string) {
  getDb().prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
}

/** Adds a default reminder the first time an item gets a due/start date. Only
 *  called on the specific null->non-null transition (see call sites below) --
 *  never unconditionally on every edit, since that would silently resurrect a
 *  reminder the user deliberately deleted. */
const DEFAULT_REMINDER_LEAD_MINUTES = 15;
function ensureDefaultReminder(ownerType: "task" | "event", ownerId: string) {
  const db = getDb();
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM reminders WHERE owner_type = ? AND owner_id = ?`).get(ownerType, ownerId) as any
  ).c as number;
  // 15 min before (matches Thunderbird's default). A non-zero lead also keeps
  // the alarm safely in the future by the time DAVx5 pulls the event to the
  // phone -- a 0-min ("at time of") default can already be past-due on arrival,
  // and Android silently drops past-due alarms rather than firing them late.
  if (count === 0) reminderCreate(ownerType, ownerId, DEFAULT_REMINDER_LEAD_MINUTES);
}

/** User-facing reminder add/remove -- unlike the raw `reminderCreate`/
 *  `reminderDelete` (used by `ensureDefaultReminder` and the remote-merge
 *  path below, neither of which should trigger a re-push), these also mark
 *  the owning task/event dirty so a reminder-only change gets pushed to
 *  CalDAV as a VALARM on the next sync. */
export function reminderCreateForOwner(ownerType: "task" | "event", ownerId: string, offsetMinutes: number): Reminder {
  const reminder = reminderCreate(ownerType, ownerId, offsetMinutes);
  if (ownerType === "task") taskUpdate(ownerId, { dirty: 1 });
  else eventUpdate(ownerId, { dirty: 1 });
  return reminder;
}

/** Looks up the reminder's owner before deleting so the IPC surface can stay
 *  a single `id` argument (matching the existing `reminders:delete` call
 *  sites in the renderer) while still marking the owner dirty. */
export function reminderDeleteForOwner(id: string) {
  const reminder = getDb().prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as unknown as Reminder | undefined;
  reminderDelete(id);
  if (!reminder) return;
  if (reminder.owner_type === "task") taskUpdate(reminder.owner_id, { dirty: 1 });
  else eventUpdate(reminder.owner_id, { dirty: 1 });
}

/** Merges reminder offsets read from a CalDAV VALARM pull into the local
 *  `reminders` table. Additive-only: only adds offsets that aren't already
 *  present locally, never removes anything. If `offsets` is empty this is a
 *  complete no-op -- critical because some CalDAV servers (this app's own
 *  Synology target included, per prior VALARM research) strip VALARM blocks
 *  entirely, so a naive "replace local reminders with what the server
 *  returned" would silently wipe every reminder the user has set on every
 *  sync. Uses the raw `reminderCreate` (not the *ForOwner wrapper) so this
 *  never marks the item dirty -- that would cause an immediate re-push and a
 *  spurious sync loop. */
export function mergeRemindersFromRemote(ownerType: "task" | "event", ownerId: string, offsets: number[]) {
  if (offsets.length === 0) return;
  const existing = remindersForOwner(ownerType, ownerId);
  const existingOffsets = new Set(existing.map((r) => r.offset_minutes));
  for (const offset of offsets) {
    if (!existingOffsets.has(offset)) {
      reminderCreate(ownerType, ownerId, offset);
      existingOffsets.add(offset);
    }
  }
}

export interface ReminderDue {
  reminderId: string;
  ownerType: "task" | "event";
  ownerId: string;
  title: string;
  /** The task's due_date / event's start_date this reminder is anchored to. */
  due: string;
}

/** Unfired reminders whose fire time has arrived. Date-only anchors (all-day
 *  tasks/events) fire at hh:mm (the user's default reminder time) on the
 *  target day, minus the offset; timed anchors fire at their exact time minus
 *  the offset. Recurring events are excluded from reminders for v1. */
export function remindersDueForNotification(hh: number, mm: number): ReminderDue[] {
  const db = getDb();
  const reminders = db.prepare(`SELECT * FROM reminders WHERE fired_at IS NULL`).all() as unknown as Reminder[];
  const now = new Date();
  const due: ReminderDue[] = [];
  for (const r of reminders) {
    let anchor: string | null = null;
    let title = "";
    if (r.owner_type === "task") {
      const t = taskGet(r.owner_id);
      if (!t || t.deleted || t.completed || !t.due_date) continue;
      anchor = t.due_date;
      title = t.title;
    } else {
      const e = eventGet(r.owner_id);
      if (!e || e.deleted || e.recurrence) continue;
      anchor = e.start_date;
      title = e.title;
    }
    const dateOnly = anchor.length <= 10;
    const anchorDate = new Date(dateOnly ? `${anchor}T00:00:00` : anchor);
    if (dateOnly) anchorDate.setHours(hh, mm, 0, 0);
    const fireAt = new Date(anchorDate.getTime() - r.offset_minutes * 60_000);
    if (fireAt <= now) due.push({ reminderId: r.id, ownerType: r.owner_type, ownerId: r.owner_id, title, due: anchor });
  }
  return due;
}

export function reminderMarkFired(id: string) {
  getDb().prepare(`UPDATE reminders SET fired_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

// ---------- Address Books ----------
export function addressBooksAll(): AddressBook[] {
  return getDb().prepare(`SELECT * FROM address_books ORDER BY sort_order ASC, name ASC`).all() as unknown as AddressBook[];
}

export function addressBookCreate(name: string, color = "#4a90d9"): AddressBook {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  const maxOrder = (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM address_books`).get() as any).m as number;
  db.prepare(
    `INSERT INTO address_books (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, color, maxOrder + 1, now, now);
  return db.prepare(`SELECT * FROM address_books WHERE id = ?`).get(id) as unknown as AddressBook;
}

export function addressBookUpdate(id: string, patch: Partial<AddressBook>): AddressBook {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM address_books WHERE id = ?`).get(id) as unknown as AddressBook;
  if (!current) throw new Error("Address book not found");
  const merged = { ...current, ...patch, updated_at: nowIso() };
  db.prepare(
    `UPDATE address_books SET name=?, color=?, sort_order=?, carddav_account_id=?, carddav_addressbook_url=?, carddav_ctag=?, updated_at=? WHERE id=?`
  ).run(
    merged.name,
    merged.color,
    merged.sort_order,
    merged.carddav_account_id,
    merged.carddav_addressbook_url,
    merged.carddav_ctag,
    merged.updated_at,
    id
  );
  return db.prepare(`SELECT * FROM address_books WHERE id = ?`).get(id) as unknown as AddressBook;
}

export function addressBookDelete(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM contacts WHERE address_book_id = ?`).run(id);
  db.prepare(`DELETE FROM address_books WHERE id = ?`).run(id);
}

// ---------- Contacts ----------
export function contactsAll(): Contact[] {
  return getDb().prepare(`SELECT * FROM contacts WHERE deleted = 0 ORDER BY fn ASC`).all() as unknown as Contact[];
}

export function contactsByBook(bookId: string): Contact[] {
  return getDb()
    .prepare(`SELECT * FROM contacts WHERE address_book_id = ? AND deleted = 0 ORDER BY fn ASC`)
    .all(bookId) as unknown as Contact[];
}

export function contactGet(id: string): Contact | undefined {
  return getDb().prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as unknown as Contact | undefined;
}

export function contactCreate(input: Partial<Contact> & { address_book_id: string }): Contact {
  const db = getDb();
  const id = nanoid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO contacts (id, address_book_id, fn, prefix, first_name, middle_name, last_name, suffix, nickname, org, title, bday, anniversary, notes, categories, photo, phones, emails, addresses, urls, impps, related, raw_vcard, carddav_uid, carddav_href, carddav_etag, deleted, dirty, sequence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`
  ).run(
    id,
    input.address_book_id,
    input.fn ?? "",
    input.prefix ?? "",
    input.first_name ?? "",
    input.middle_name ?? "",
    input.last_name ?? "",
    input.suffix ?? "",
    input.nickname ?? "",
    input.org ?? "",
    input.title ?? "",
    input.bday ?? null,
    input.anniversary ?? null,
    input.notes ?? "",
    input.categories ?? "",
    input.photo ?? "",
    input.phones ?? "[]",
    input.emails ?? "[]",
    input.addresses ?? "[]",
    input.urls ?? "[]",
    input.impps ?? "[]",
    input.related ?? "[]",
    input.raw_vcard ?? "",
    input.carddav_uid ?? null,
    input.carddav_href ?? null,
    input.carddav_etag ?? null,
    // Sync-created contacts arrive with a CardDAV UID and are already on the
    // server; anything else is a local creation that still needs pushing.
    input.dirty ?? (input.carddav_uid ? 0 : 1),
    now,
    now
  );
  return contactGet(id)!;
}

export function contactUpdate(id: string, patch: Partial<Contact>): Contact {
  const db = getDb();
  const current = contactGet(id);
  if (!current) throw new Error("Contact not found");
  // Same convention as tasks/events: an update carrying carddav_etag comes from
  // the sync engine and leaves the contact clean; anything else is a user edit
  // that still needs pushing.
  const isSyncUpdate = Object.prototype.hasOwnProperty.call(patch, "carddav_etag");
  let dirty: 0 | 1;
  if (patch.dirty !== undefined) dirty = patch.dirty;
  else if (isSyncUpdate) dirty = 0;
  else dirty = 1;
  const sequence = dirty === 1 && !isSyncUpdate ? current.sequence + 1 : current.sequence;
  const merged: Contact = { ...current, ...patch, dirty, sequence, updated_at: nowIso() };
  db.prepare(
    `UPDATE contacts SET address_book_id=?, fn=?, prefix=?, first_name=?, middle_name=?, last_name=?, suffix=?, nickname=?, org=?, title=?, bday=?, anniversary=?, notes=?, categories=?, photo=?, phones=?, emails=?, addresses=?, urls=?, impps=?, related=?, raw_vcard=?, carddav_uid=?, carddav_href=?, carddav_etag=?, deleted=?, dirty=?, sequence=?, updated_at=? WHERE id=?`
  ).run(
    merged.address_book_id,
    merged.fn,
    merged.prefix,
    merged.first_name,
    merged.middle_name,
    merged.last_name,
    merged.suffix,
    merged.nickname,
    merged.org,
    merged.title,
    merged.bday,
    merged.anniversary,
    merged.notes,
    merged.categories,
    merged.photo,
    merged.phones,
    merged.emails,
    merged.addresses,
    merged.urls,
    merged.impps,
    merged.related,
    merged.raw_vcard,
    merged.carddav_uid,
    merged.carddav_href,
    merged.carddav_etag,
    merged.deleted,
    merged.dirty,
    merged.sequence,
    merged.updated_at,
    id
  );
  return contactGet(id)!;
}

export function contactDelete(id: string, hard = false) {
  const db = getDb();
  if (hard) {
    db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  } else {
    db.prepare(`UPDATE contacts SET deleted = 1, updated_at = ? WHERE id = ?`).run(nowIso(), id);
  }
}

/** All contacts (including soft-deleted) for a book, keyed by CardDAV uid --
 *  used by the sync engine to diff against what the server currently has. */
export function contactsByBookWithUid(bookId: string): Map<string, Contact> {
  const rows = getDb()
    .prepare(`SELECT * FROM contacts WHERE address_book_id = ?`)
    .all(bookId) as unknown as Contact[];
  const map = new Map<string, Contact>();
  for (const c of rows) if (c.carddav_uid) map.set(c.carddav_uid, c);
  return map;
}

/** Removes local contacts for this book whose uid is no longer present remotely
 *  (hard delete). Skips rows with unpushed local edits (`dirty`). */
export function contactsPruneMissing(bookId: string, remoteUids: Set<string>) {
  const db = getDb();
  const local = db
    .prepare(`SELECT id, carddav_uid, dirty FROM contacts WHERE address_book_id = ?`)
    .all(bookId) as { id: string; carddav_uid: string | null; dirty: 0 | 1 }[];
  for (const row of local) {
    if (row.carddav_uid && !remoteUids.has(row.carddav_uid) && !row.dirty) {
      db.prepare(`DELETE FROM contacts WHERE id = ?`).run(row.id);
    }
  }
}
