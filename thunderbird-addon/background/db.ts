// Port of electron/db.ts. Query bodies are unchanged from the original;
// the only systematic differences are (a) every exported function is now
// async because sql.js/IndexedDB init is async, and (b) every mutation
// calls persist() before returning so the IndexedDB copy never falls behind.
import { nanoid } from "nanoid";
import { RRule } from "rrule";
import { getDb, persist } from "./storage";

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
  due_date: string | null;
  start_date: string | null;
  priority: 0 | 1 | 5 | 9;
  completed: 0 | 1;
  completed_at: string | null;
  recurrence: string | null;
  tags: string;
  sort_order: number;
  caldav_uid: string | null;
  caldav_href: string | null;
  caldav_etag: string | null;
  deleted: 0 | 1;
  /** 1 = has local edits not yet pushed to the CalDAV server */
  dirty: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CaldavAccount {
  id: string;
  label: string;
  server_url: string;
  username: string;
  password_enc: string; // base64 (see background/caldav.ts encodePassword) -- see credential-storage note in README
  principal_url: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

// ---------- Lists ----------
export async function listsAll(): Promise<TaskList[]> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM lists ORDER BY sort_order ASC, name ASC`).all() as unknown as TaskList[];
}

export async function listCreate(name: string, color = "#4a90d9"): Promise<TaskList> {
  const db = await getDb();
  const id = nanoid();
  const now = nowIso();
  const maxOrder = (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM lists`).get() as any).m as number;
  db.prepare(
    `INSERT INTO lists (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, color, maxOrder + 1, now, now);
  await persist();
  return db.prepare(`SELECT * FROM lists WHERE id = ?`).get(id) as unknown as TaskList;
}

export async function listUpdate(id: string, patch: Partial<TaskList>): Promise<TaskList> {
  const db = await getDb();
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
  await persist();
  return db.prepare(`SELECT * FROM lists WHERE id = ?`).get(id) as unknown as TaskList;
}

export async function listDelete(id: string): Promise<void> {
  const db = await getDb();
  db.prepare(`DELETE FROM tasks WHERE list_id = ?`).run(id);
  db.prepare(`DELETE FROM lists WHERE id = ?`).run(id);
  await persist();
}

// ---------- Tasks ----------
export async function tasksAll(): Promise<Task[]> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM tasks WHERE deleted = 0 ORDER BY sort_order ASC, created_at ASC`).all() as unknown as Task[];
}

export async function tasksByList(listId: string): Promise<Task[]> {
  const db = await getDb();
  return db
    .prepare(`SELECT * FROM tasks WHERE list_id = ? AND deleted = 0 ORDER BY sort_order ASC, created_at ASC`)
    .all(listId) as unknown as Task[];
}

export async function taskGet(id: string): Promise<Task | undefined> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task | undefined;
}

export async function taskCreate(input: Partial<Task> & { list_id: string; title: string }): Promise<Task> {
  const db = await getDb();
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
    input.dirty ?? (input.caldav_uid ? 0 : 1),
    now,
    now
  );
  await persist();
  return (await taskGet(id))!;
}

export async function taskUpdate(id: string, patch: Partial<Task>): Promise<Task> {
  const db = await getDb();
  const current = await taskGet(id);
  if (!current) throw new Error("Task not found");
  const isSyncUpdate = Object.prototype.hasOwnProperty.call(patch, "caldav_etag");
  const dirty: 0 | 1 = patch.dirty !== undefined ? patch.dirty : isSyncUpdate ? 0 : 1;
  const merged: Task = { ...current, ...patch, dirty, updated_at: nowIso() };
  db.prepare(
    `UPDATE tasks SET list_id=?, parent_id=?, title=?, notes=?, due_date=?, start_date=?,
     priority=?, completed=?, completed_at=?, recurrence=?, tags=?, sort_order=?,
     caldav_uid=?, caldav_href=?, caldav_etag=?, deleted=?, dirty=?, updated_at=?
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
    merged.updated_at,
    id
  );
  await persist();
  return (await taskGet(id))!;
}

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

export async function taskToggleComplete(id: string): Promise<Task> {
  const t = await taskGet(id);
  if (!t) throw new Error("Task not found");
  // Completing a recurring task reschedules it (Tasks.org behavior).
  if (!t.completed && t.recurrence && t.due_date) {
    const next = nextOccurrence(t.recurrence, t.due_date);
    if (next) {
      const patch: Partial<Task> = { due_date: next };
      if (t.start_date) {
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

export async function taskDelete(id: string, hard = false): Promise<void> {
  const db = await getDb();
  if (hard) {
    db.prepare(`DELETE FROM tasks WHERE id = ? OR parent_id = ?`).run(id, id);
  } else {
    db.prepare(`UPDATE tasks SET deleted = 1, updated_at = ? WHERE id = ? OR parent_id = ?`).run(nowIso(), id, id);
  }
  await persist();
}

export async function subtasksOf(parentId: string): Promise<Task[]> {
  const db = await getDb();
  return db
    .prepare(`SELECT * FROM tasks WHERE parent_id = ? AND deleted = 0 ORDER BY sort_order ASC`)
    .all(parentId) as unknown as Task[];
}

// ---------- CalDAV accounts ----------
export async function accountsAll(): Promise<CaldavAccount[]> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM caldav_accounts ORDER BY created_at ASC`).all() as unknown as CaldavAccount[];
}

export async function accountCreate(
  input: Omit<CaldavAccount, "id" | "created_at" | "last_sync_at" | "last_sync_status">
): Promise<CaldavAccount> {
  const db = await getDb();
  const id = nanoid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO caldav_accounts (id, label, server_url, username, password_enc, principal_url, last_sync_at, last_sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(id, input.label, input.server_url, input.username, input.password_enc, input.principal_url ?? null, now);
  await persist();
  return db.prepare(`SELECT * FROM caldav_accounts WHERE id = ?`).get(id) as unknown as CaldavAccount;
}

export async function accountUpdate(id: string, patch: Partial<CaldavAccount>): Promise<CaldavAccount> {
  const db = await getDb();
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
  await persist();
  return db.prepare(`SELECT * FROM caldav_accounts WHERE id = ?`).get(id) as unknown as CaldavAccount;
}

export async function accountDelete(id: string): Promise<void> {
  const db = await getDb();
  db.prepare(`UPDATE lists SET caldav_account_id = NULL, caldav_calendar_url = NULL, caldav_ctag = NULL WHERE caldav_account_id = ?`).run(id);
  db.prepare(`DELETE FROM caldav_accounts WHERE id = ?`).run(id);
  await persist();
}
