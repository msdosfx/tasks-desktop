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
  created_at: string;
  updated_at: string;
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

    CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  `);

  // Older databases predate these columns.
  try { db.exec(`ALTER TABLE tasks ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN notified_at TEXT`); } catch { /* already present */ }

  const listCount = db.prepare("SELECT COUNT(*) AS c FROM lists").get() as { c: number };
  if (listCount.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO lists (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), "Tasks", "#4a90d9", 0, now, now);
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
  const merged: Task = { ...current, ...patch, dirty, updated_at: nowIso() };
  // A new due date (edit, snooze, recurrence advance, or a change pulled from
  // the server) gets a fresh reminder.
  if (patch.due_date !== undefined && patch.due_date !== current.due_date) merged.notified_at = null;
  db.prepare(
    `UPDATE tasks SET list_id=?, parent_id=?, title=?, notes=?, due_date=?, start_date=?,
     priority=?, completed=?, completed_at=?, recurrence=?, tags=?, sort_order=?,
     caldav_uid=?, caldav_href=?, caldav_etag=?, deleted=?, dirty=?, notified_at=?, updated_at=?
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
    merged.notified_at,
    merged.updated_at,
    id
  );
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
/** Open tasks whose reminder time has arrived and that haven't been notified
 *  for their current due date. Timed tasks fire at their time; date-only tasks
 *  fire at hh:mm (the user's default reminder time) on the due day. */
export function tasksDueForNotification(hh: number, mm: number): Task[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE deleted = 0 AND completed = 0 AND due_date IS NOT NULL AND notified_at IS NULL`)
    .all() as unknown as Task[];
  const now = new Date();
  return rows.filter((t) => {
    const due = t.due_date!;
    const fireAt = new Date(due.length <= 10 ? `${due}T00:00:00` : due);
    if (due.length <= 10) fireAt.setHours(hh, mm, 0, 0);
    return fireAt <= now;
  });
}

export function taskMarkNotified(id: string) {
  getDb().prepare(`UPDATE tasks SET notified_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}
