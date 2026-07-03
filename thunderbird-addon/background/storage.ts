// Replacement for electron/db.ts's dbPath()/getDb() pair. node:sqlite doesn't
// exist in a WebExtension, so we use sql.js (SQLite compiled to wasm) and
// persist the serialized database to IndexedDB after every mutation.
//
// Trade-off, accepted deliberately (see docs/thunderbird-addon-plan.md
// discussion): this re-serializes the *entire* database on every write. At
// personal-task-list scale (tens to low thousands of rows) that's well under
// a millisecond and not worth the complexity of wa-sqlite's incremental
// OPFS/IndexedDB virtual filesystem.
import initSqlJs from "sql.js";
import { nanoid } from "nanoid";
import { DatabaseAdapter } from "./sqlite-adapter";

const IDB_NAME = "tasks-desktop";
const IDB_STORE = "sqlite";
const IDB_KEY = "db-blob";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBlob(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let _adapter: DatabaseAdapter | null = null;
let _initPromise: Promise<DatabaseAdapter> | null = null;

async function init(): Promise<DatabaseAdapter> {
  // sql.js's own internal fetch/streaming path for locating the .wasm file
  // (via locateFile) reliably fails inside a Thunderbird background page --
  // confirmed by hand: a plain fetch() of the exact same
  // browser.runtime.getURL("sql-wasm.wasm") URL succeeds (200,
  // application/wasm) in this same context, while initSqlJs({ locateFile })
  // aborts on both the streaming and ArrayBuffer fallback paths. Fetching
  // the bytes ourselves and handing them to initSqlJs via `wasmBinary`
  // sidesteps whatever that internal path is doing wrong.
  const wasmResponse = await fetch(browser.runtime.getURL("sql-wasm.wasm"));
  if (!wasmResponse.ok) {
    throw new Error(`Failed to fetch sql-wasm.wasm: ${wasmResponse.status} ${wasmResponse.statusText}`);
  }
  const wasmBinary = await wasmResponse.arrayBuffer();
  const SQL = await initSqlJs({ wasmBinary });
  const existing = await loadBlob();
  const raw = existing ? new SQL.Database(existing) : new SQL.Database();
  const adapter = new DatabaseAdapter(raw);
  migrate(adapter);
  if (!existing) await persist(adapter);
  return adapter;
}

/** Returns the (lazily-initialized, memoized) database adapter. Failed
 *  initialization attempts are not cached, so a transient failure (e.g. the
 *  IndexedDB open racing something else) can be retried on the next call
 *  instead of permanently wedging the extension until a manual reload. */
export async function getDb(): Promise<DatabaseAdapter> {
  if (_adapter) return _adapter;
  if (!_initPromise) {
    _initPromise = init()
      .then((a) => (_adapter = a))
      .catch((err) => {
        _initPromise = null;
        throw err;
      });
  }
  return _initPromise;
}

/** Serializes the current DB state to IndexedDB. Call after every write. */
export async function persist(adapter?: DatabaseAdapter): Promise<void> {
  const a = adapter ?? _adapter;
  if (!a) return;
  await saveBlob(a.export());
}

function migrate(db: DatabaseAdapter) {
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  `);

  // Older databases predate the dirty column.
  try { db.exec(`ALTER TABLE tasks ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0`); } catch { /* already present */ }

  const listCount = db.prepare(`SELECT COUNT(*) AS c FROM lists`).get() as { c: number };
  if (listCount.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO lists (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), "Tasks", "#4a90d9", 0, now, now);
  }
}
