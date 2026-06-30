import { createDAVClient } from "tsdav";

type Client = Awaited<ReturnType<typeof createDAVClient>>;
import { safeStorage } from "electron";
import {
  getDb,
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
} from "./db.js";
import { taskToVTodo, parseVTodo, newUid } from "./ical.js";

export function encryptPassword(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString("base64");
  }
  return Buffer.from(plain, "utf-8").toString("base64");
}

export function decryptPassword(enc: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    }
  } catch {
    // fall through to base64 decode for unencrypted/legacy values
  }
  return Buffer.from(enc, "base64").toString("utf-8");
}

async function clientFor(account: CaldavAccount): Promise<Client> {
  const client = await createDAVClient({
    serverUrl: account.server_url,
    credentials: {
      username: account.username,
      password: decryptPassword(account.password_enc)
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
      // If the server doesn't advertise supported-calendar-component-set, assume it could hold todos.
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

/** Link a local list to a discovered remote calendar. Any other list previously
 *  linked to this same calendar is unlinked first, so a calendar only ever
 *  points at one list at a time. */
export function linkListToCalendar(listId: string, accountId: string, calendarUrl: string) {
  const previouslyLinked = listsAll().filter(
    (l) => l.caldav_account_id === accountId && l.caldav_calendar_url === calendarUrl && l.id !== listId
  );
  for (const l of previouslyLinked) {
    listUpdate(l.id, { caldav_account_id: null, caldav_calendar_url: null, caldav_ctag: null } as Partial<TaskList>);
  }
  listUpdate(listId, {
    caldav_account_id: accountId,
    caldav_calendar_url: calendarUrl,
    caldav_ctag: null
  } as Partial<TaskList>);
}

/** Remove the calendar link from a list (sets it back to local-only). */
export function unlinkList(listId: string) {
  listUpdate(listId, {
    caldav_account_id: null,
    caldav_calendar_url: null,
    caldav_ctag: null
  } as Partial<TaskList>);
}

/** Create a new calendar on the server, make a local list, and link them together. */
export async function createServerCalendar(account: CaldavAccount, name: string): Promise<TaskList> {
  const client = await clientFor(account);

  // Derive the calendar home URL from an existing calendar (strip its last path segment).
  const calendars = await client.fetchCalendars();
  if (calendars.length === 0) {
    throw new Error("No existing calendars found on server — cannot determine where to create the new calendar.");
  }
  const existingUrl = String(calendars[0].url).replace(/\/?$/, "/");
  const calHomeUrl = existingUrl.replace(/[^/]+\/$/, "");

  // Build a URL-safe slug from the name.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
  const newCalUrl = `${calHomeUrl}${slug}-${Date.now()}/`;

  await client.makeCalendar({
    url: newCalUrl,
    props: { displayname: name }
  });

  const newList = listCreate(name);
  linkListToCalendar(newList.id, account.id, newCalUrl);
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

  // Best-effort: pull calendar colors from server and apply them to linked lists.
  try {
    const calendars = await client.fetchCalendars();
    const calByUrl = new Map(calendars.map((c) => [String(c.url), c]));
    for (const list of listsAll().filter((l) => l.caldav_account_id === account.id && l.caldav_calendar_url)) {
      const cal = calByUrl.get(list.caldav_calendar_url!);
      if (cal?.calendarColor) listUpdate(list.id, { color: cal.calendarColor } as Partial<TaskList>);
    }
  } catch { /* non-fatal */ }

  const linkedLists = listsAll().filter((l) => l.caldav_account_id === account.id && l.caldav_calendar_url);
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
    // tsdav defaults to a VEVENT comp-filter when none is given, which silently
    // excludes VTODO items (our tasks) from the server's response. Request VTODO
    // explicitly so to-dos actually come back.
    console.log(`[caldav] fetchCalendarObjects starting for ${calendarUrl}`);
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
    console.log(`[caldav] fetchCalendarObjects returned ${objects.length} object(s) for ${calendarUrl}`);
    const remoteByUid = new Map<string, { url: string; etag: string; data: string }>();
    for (const obj of objects) {
      const parsed = parseVTodo(obj.data || "");
      if (parsed) remoteByUid.set(parsed.uid, { url: obj.url, etag: obj.etag || "", data: obj.data || "" });
    }

    const localTasks = tasksByList(list.id);
    const localByUid = new Map<string, Task>();
    for (const t of localTasks) if (t.caldav_uid) localByUid.set(t.caldav_uid, t);

    // Pull: remote items that are new or changed (by etag) get applied locally.
    for (const [uid, remote] of remoteByUid) {
      const parsed = parseVTodo(remote.data)!;
      const local = localByUid.get(uid);
      if (!local) {
        taskCreate({
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
        taskUpdate(local.id, {
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
    const freshLocalTasks = tasksByList(list.id);
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
          taskUpdate(local.id, {
            caldav_uid: uid,
            caldav_href: created.url || `${calendarUrl}${filename}`,
            caldav_etag: created.headers?.get?.("etag") || null
          } as Partial<Task>);
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Create failed for "${local.title}": ${err?.message || err}`);
        }
      } else {
        const remote = remoteByUid.get(local.caldav_uid);
        const remoteEtag = remote?.etag ?? null;
        if (remoteEtag !== local.caldav_etag) continue; // pulled this round already, skip pushing stale copy
        const { ics } = taskToVTodo(local);
        try {
          const updated = await client.updateCalendarObject({
            calendarObject: {
              url: local.caldav_href || remote?.url || "",
              data: ics,
              etag: local.caldav_etag || ""
            }
          });
          taskUpdate(local.id, {
            caldav_etag: updated.headers?.get?.("etag") || local.caldav_etag
          } as Partial<Task>);
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Update failed for "${local.title}": ${err?.message || err}`);
        }
      }
    }

    // Handle local deletions (soft-deleted tasks that still have a caldav_uid).
    const db = getDb();
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
      taskDelete(t.id, true);
    }
  } catch (err: any) {
    result.errors.push(err?.message || String(err));
  }

  return result;
}
