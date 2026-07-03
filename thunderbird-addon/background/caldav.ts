// Port of electron/caldav.ts. Sync logic (testConnection, discoverCalendars,
// linkListToCalendar, unlinkList, createServerCalendar, syncAccount, syncList)
// is unchanged -- tsdav and ical.js are both fetch-based with no Node
// dependency, so they run as-is in a background script. Two real changes:
//   1. Every db.ts call is now awaited (db.ts is async here, see db.ts).
//   2. safeStorage (Electron/OS-keychain) is replaced with plain base64,
//      per the agreed decision to accept the same protection level Electron's
//      own "encryption unavailable" fallback already used -- storage.local
//      is only as protected as the Thunderbird profile directory itself.
//      See README.md's "Credential storage" note before relying on this.
import { createDAVClient } from "tsdav";

type Client = Awaited<ReturnType<typeof createDAVClient>>;
import {
  CaldavAccount,
  TaskList,
  Task,
  listsAll,
  listUpdate,
  listCreate,
  tasksByList,
  taskCreate,
  taskUpdate,
  taskDelete
} from "./db";
import { getDb } from "./storage";
import { taskToVTodo, parseVTodo, newUid } from "./ical";

/** Not real encryption -- see file header. Named encode/decode, not
 *  encrypt/decrypt, so nobody mistakes this for a security boundary. */
export function encodePassword(plain: string): string {
  return btoa(unescape(encodeURIComponent(plain)));
}

export function decodePassword(enc: string): string {
  try {
    return decodeURIComponent(escape(atob(enc)));
  } catch {
    return "";
  }
}

// Extension pages get a CORS exemption for hosts listed in host_permissions,
// but only once the permission has actually been granted -- host_permissions
// in the manifest are declared as *optional* (see manifest.json). Requesting
// it requires a user gesture, which a background script never has, so that
// lives in thunderbird-addon/tab/api-shim.ts (ensureHostPermission), called
// directly from SettingsModal's click handlers before any of the functions
// below ever run.

async function clientFor(account: CaldavAccount): Promise<Client> {
  const client = await createDAVClient({
    serverUrl: account.server_url,
    credentials: {
      username: account.username,
      password: decodePassword(account.password_enc)
    },
    authMethod: "Basic",
    defaultAccountType: "caldav"
  });
  return client;
}

export interface DiscoveredCalendar {
  url: string;
  displayName: string;
  ctag: string | null;
  supportsTodo: boolean;
  color: string | null;
}

export async function testConnection(account: CaldavAccount): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await clientFor(account);
    const calendars = await client.fetchCalendars();
    return { ok: true, message: `Connected. Found ${calendars.length} calendar(s).` };
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
}

export async function discoverCalendars(account: CaldavAccount): Promise<DiscoveredCalendar[]> {
  const client = await clientFor(account);
  const calendars = await client.fetchCalendars();
  return calendars
    .filter((cal) => {
      const comps = (cal as any).components as string[] | undefined;
      return !comps || comps.includes("VTODO");
    })
    .map((cal) => ({
      url: String(cal.url),
      displayName: String(cal.displayName || cal.url),
      ctag: (cal as any).ctag ?? null,
      supportsTodo: true,
      color: cal.calendarColor ?? (cal as any).color ?? null
    }));
}

export async function linkListToCalendar(listId: string, accountId: string, calendarUrl: string): Promise<void> {
  const previouslyLinked = (await listsAll()).filter(
    (l) => l.caldav_account_id === accountId && l.caldav_calendar_url === calendarUrl && l.id !== listId
  );
  for (const l of previouslyLinked) {
    await listUpdate(l.id, { caldav_account_id: null, caldav_calendar_url: null, caldav_ctag: null } as Partial<TaskList>);
  }
  await listUpdate(listId, {
    caldav_account_id: accountId,
    caldav_calendar_url: calendarUrl,
    caldav_ctag: null
  } as Partial<TaskList>);
}

export async function unlinkList(listId: string): Promise<void> {
  await listUpdate(listId, {
    caldav_account_id: null,
    caldav_calendar_url: null,
    caldav_ctag: null
  } as Partial<TaskList>);
}

export async function createServerCalendar(account: CaldavAccount, name: string): Promise<TaskList> {
  const client = await clientFor(account);

  const calendars = await client.fetchCalendars();
  if (calendars.length === 0) {
    throw new Error("No existing calendars found on server — cannot determine where to create the new calendar.");
  }
  const existingUrl = String(calendars[0].url).replace(/\/?$/, "/");
  const calHomeUrl = existingUrl.replace(/[^/]+\/$/, "");

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
  const newCalUrl = `${calHomeUrl}${slug}-${Date.now()}/`;

  await client.makeCalendar({
    url: newCalUrl,
    props: { displayname: name }
  });

  const newList = await listCreate(name);
  await linkListToCalendar(newList.id, account.id, newCalUrl);
  return newList;
}

export interface SyncResult {
  listId: string;
  pulled: number;
  pushed: number;
  errors: string[];
}

/** Two-way sync for every list linked to this account. */
export async function syncAccount(account: CaldavAccount): Promise<SyncResult[]> {
  const client = await clientFor(account);

  try {
    const calendars = await client.fetchCalendars();
    const calByUrl = new Map(calendars.map((c) => [String(c.url), c]));
    for (const list of (await listsAll()).filter((l) => l.caldav_account_id === account.id && l.caldav_calendar_url)) {
      const cal = calByUrl.get(list.caldav_calendar_url!);
      if (cal?.calendarColor) await listUpdate(list.id, { color: cal.calendarColor } as Partial<TaskList>);
    }
  } catch {
    /* non-fatal */
  }

  const linkedLists = (await listsAll()).filter((l) => l.caldav_account_id === account.id && l.caldav_calendar_url);
  const results: SyncResult[] = [];
  for (const list of linkedLists) {
    results.push(await syncList(client, list));
  }
  return results;
}

async function syncList(client: Client, list: TaskList): Promise<SyncResult> {
  const result: SyncResult = { listId: list.id, pulled: 0, pushed: 0, errors: [] };
  const calendarUrl = list.caldav_calendar_url!;

  try {
    const calendar = { url: calendarUrl } as any;
    const objects = await Promise.race([
      client.fetchCalendarObjects({
        calendar,
        filters: [
          {
            "comp-filter": {
              _attributes: { name: "VCALENDAR" },
              "comp-filter": {
                _attributes: { name: "VTODO" }
              }
            }
          }
        ] as any
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fetchCalendarObjects timed out after 15s")), 15000))
    ]);
    const remoteByUid = new Map<string, { url: string; etag: string; data: string }>();
    for (const obj of objects) {
      const parsed = parseVTodo(obj.data || "");
      if (parsed) remoteByUid.set(parsed.uid, { url: obj.url, etag: obj.etag || "", data: obj.data || "" });
    }

    const localTasks = await tasksByList(list.id);
    const localByUid = new Map<string, Task>();
    for (const t of localTasks) if (t.caldav_uid) localByUid.set(t.caldav_uid, t);

    // Pull: remote items that are new or changed (by etag) get applied locally.
    for (const [uid, remote] of remoteByUid) {
      const parsed = parseVTodo(remote.data)!;
      const local = localByUid.get(uid);
      if (!local) {
        await taskCreate({
          list_id: list.id,
          title: parsed.title,
          notes: parsed.notes,
          due_date: parsed.due_date,
          start_date: parsed.start_date,
          priority: parsed.priority,
          completed: parsed.completed,
          completed_at: parsed.completed_at,
          recurrence: parsed.recurrence,
          tags: parsed.tags,
          caldav_uid: uid,
          caldav_href: remote.url,
          caldav_etag: remote.etag
        });
        result.pulled++;
      } else if (local.caldav_etag !== remote.etag) {
        if (local.dirty) {
          // Both sides changed since the last sync: remote wins on the synced
          // task, local edits survive as a new unsynced task pushed below.
          await taskCreate({
            list_id: list.id,
            parent_id: local.parent_id,
            title: `${local.title} (conflicted copy)`,
            notes: local.notes,
            due_date: local.due_date,
            start_date: local.start_date,
            priority: local.priority,
            completed: local.completed,
            completed_at: local.completed_at,
            recurrence: local.recurrence,
            tags: local.tags
          });
        }
        await taskUpdate(local.id, {
          title: parsed.title,
          notes: parsed.notes,
          due_date: parsed.due_date,
          start_date: parsed.start_date,
          priority: parsed.priority,
          completed: parsed.completed,
          completed_at: parsed.completed_at,
          recurrence: parsed.recurrence,
          tags: parsed.tags,
          caldav_href: remote.url,
          caldav_etag: remote.etag
        });
        result.pulled++;
      }
    }

    // Push: local items with no UID (new) or modified after last known etag.
    const freshLocalTasks = await tasksByList(list.id);
    for (const local of freshLocalTasks) {
      if (local.deleted) continue;
      if (!local.caldav_uid) {
        const uid = newUid();
        const { ics } = taskToVTodo(local, uid);
        const filename = `${uid}.ics`;
        try {
          const created = await client.createCalendarObject({
            calendar: { url: calendarUrl } as any,
            filename,
            iCalString: ics
          });
          await taskUpdate(local.id, {
            caldav_uid: uid,
            caldav_href: created.url || `${calendarUrl}${filename}`,
            caldav_etag: created.headers?.get?.("etag") || null
          } as Partial<Task>);
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Create failed for "${local.title}": ${err?.message || err}`);
        }
      } else {
        // Only push tasks with local edits; re-uploading unchanged tasks
        // churns etags and makes other devices clobber their pending edits.
        if (!local.dirty) continue;
        const remote = remoteByUid.get(local.caldav_uid);
        const remoteEtag = remote?.etag ?? null;
        if (remoteEtag !== local.caldav_etag) continue;
        const { ics } = taskToVTodo(local);
        try {
          const updated = await client.updateCalendarObject({
            calendarObject: {
              url: local.caldav_href || remote?.url || "",
              data: ics,
              etag: local.caldav_etag || ""
            }
          });
          await taskUpdate(local.id, {
            caldav_etag: updated.headers?.get?.("etag") || local.caldav_etag
          } as Partial<Task>);
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Update failed for "${local.title}": ${err?.message || err}`);
        }
      }
    }

    // Handle local deletions (soft-deleted tasks that still have a caldav_uid).
    const db = await getDb();
    const deletedWithRemote = db
      .prepare(`SELECT * FROM tasks WHERE list_id = ? AND deleted = 1 AND caldav_uid IS NOT NULL`)
      .all(list.id) as unknown as Task[];
    for (const t of deletedWithRemote) {
      try {
        await client.deleteCalendarObject({
          calendarObject: { url: t.caldav_href || "", etag: t.caldav_etag || "" }
        });
      } catch (err: any) {
        result.errors.push(`Delete failed for "${t.title}": ${err?.message || err}`);
      }
      await taskDelete(t.id, true);
    }
  } catch (err: any) {
    result.errors.push(err?.message || String(err));
  }

  return result;
}
