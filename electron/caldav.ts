import { createDAVClient } from "tsdav";

type Client = Awaited<ReturnType<typeof createDAVClient>>;
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  getDb,
  CaldavAccount,
  TaskList,
  Task,
  CalendarEvent,
  listsAll,
  listUpdate,
  listCreate,
  tasksByList,
  taskCreate,
  taskUpdate,
  taskDelete,
  eventsByList,
  eventsByListWithUid,
  eventCreate,
  eventUpdate,
  eventDelete,
  eventUpsertFromRemote,
  eventsPruneMissing,
  remindersForOwner,
  mergeRemindersFromRemote
} from "./db.js";
import { taskToVTodo, parseVTodo, newUid, ParsedVTodo, eventToVEvent, parseVEvent, ParsedVEvent } from "./ical.js";

/** Append a timestamped line to sync.log in the app's user-data folder, so sync
 *  behavior can be diagnosed after the fact. Best-effort: never breaks sync. */
export function syncLog(line: string) {
  try {
    const file = path.join(app.getPath("userData"), "sync.log");
    try {
      if (fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.1`);
    } catch { /* file doesn't exist yet */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never break sync */ }
}

/** Compare two object URLs by path only (servers report absolute or relative). */
function samePath(a: string, b: string): boolean {
  const p = (u: string) => { try { return new URL(u, "http://x").pathname; } catch { return u; } };
  return p(a) === p(b);
}

/** Date equality that tolerates formatting differences (ms, timezone spelling)
 *  but distinguishes date-only from date+time values. */
function dateEq(a: string | null, b: string | null): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  const aDateOnly = a.length <= 10;
  const bDateOnly = b.length <= 10;
  if (aDateOnly !== bDateOnly) return false;
  return aDateOnly ? a === b : new Date(a).getTime() === new Date(b).getTime();
}

/** True when the remote VTODO carries the same content as the local task. Then
 *  an etag difference is just a version-stamp move — typically our own last
 *  push whose PUT response carried no ETag header — not a real remote edit. */
function sameContent(local: Task, remote: ParsedVTodo): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim();
  const tagSet = (s: string | null | undefined) =>
    norm(s).split(",").map((t) => t.trim()).filter(Boolean).sort().join(",");
  return (
    norm(local.title) === norm(remote.title) &&
    norm(local.notes) === norm(remote.notes) &&
    dateEq(local.due_date, remote.due_date) &&
    dateEq(local.start_date, remote.start_date) &&
    (local.priority || 0) === (remote.priority || 0) &&
    (local.completed ? 1 : 0) === remote.completed &&
    norm(local.recurrence) === norm(remote.recurrence) &&
    tagSet(local.tags) === tagSet(remote.tags)
  );
}

/** True when the remote VEVENT carries the same content as the local event.
 *  Same purpose as `sameContent` for tasks -- an etag-only move (typically our
 *  own last push) shouldn't be treated as a real remote edit. */
function sameEventContent(local: CalendarEvent, remote: ParsedVEvent): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim();
  const tagSet = (s: string | null | undefined) =>
    norm(s).split(",").map((t) => t.trim()).filter(Boolean).sort().join(",");
  return (
    norm(local.title) === norm(remote.title) &&
    norm(local.notes) === norm(remote.notes) &&
    norm(local.location) === norm(remote.location) &&
    dateEq(local.start_date, remote.start_date) &&
    dateEq(local.end_date, remote.end_date) &&
    (local.all_day ? 1 : 0) === remote.all_day &&
    norm(local.recurrence) === norm(remote.recurrence) &&
    tagSet(local.tags) === tagSet(remote.tags)
  );
}

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
  // Previously filtered to VTODO-capable calendars only, since linking was
  // task-only. Now that the calendar view pulls VEVENTs too, event-only
  // calendars (the common case for Google/Outlook-style setups where Tasks
  // and Calendar are separate collections) need to be linkable as well.
  return calendars
    .map((cal) => ({
      url: String(cal.url),
      displayName: String(cal.displayName || cal.url),
      ctag: (cal as any).ctag ?? null,
      supportsTodo: !((cal as any).components as string[] | undefined)
        || ((cal as any).components as string[]).includes("VTODO"),
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
    // Two-way sync for this calendar's VEVENTs. Runs after task sync.
    // Recurring events stay read-only (server always wins); non-recurring
    // events get the same etag/dirty/conflict handling as tasks. Failures are
    // logged but never surfaced as sync errors (see syncEvents).
    await syncEvents(client, list);
  }
  return results;
}

/** Two-way sync of VEVENTs for a linked list's calendar. Recurring events
 *  (have an RRULE) are still read-only — the server's version always wins, no
 *  local edits are possible for them yet (see docs/roadmap.md "Recurring
 *  event editing"). Non-recurring events get full create/edit/delete with the
 *  same etag/dirty/conflict-copy handling `syncList` uses for tasks. */
async function syncEvents(client: Client, list: TaskList) {
  const calendarUrl = list.caldav_calendar_url!;
  try {
    const objects = await Promise.race([
      client.fetchCalendarObjects({
        calendar: { url: calendarUrl } as any,
        filters: [
          {
            "comp-filter": {
              _attributes: { name: "VCALENDAR" },
              "comp-filter": {
                _attributes: { name: "VEVENT" }
              }
            }
          }
        ] as any
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fetchCalendarObjects (events) timed out after 15s")), 15000)
      )
    ]);
    const remoteByUid = new Map<string, { url: string; etag: string; parsed: ParsedVEvent }>();
    const remoteUids = new Set<string>();
    for (const obj of objects) {
      const parsed = parseVEvent(obj.data || "");
      if (!parsed) continue;
      // TEMP diagnostic -- comparing Tasks Desktop's own pushed VALARM
      // against Thunderbird's, to see why Android isn't firing ours. Remove
      // once resolved.
      if ((obj.data || "").includes("VALARM")) {
        syncLog(`VALARM-DEBUG event "${parsed.title}":\n${obj.data}`);
      }
      remoteUids.add(parsed.uid);
      remoteByUid.set(parsed.uid, { url: obj.url, etag: obj.etag || "", parsed });
    }

    // Includes soft-deleted rows (unlike eventsByList) -- a local delete that
    // hasn't been pushed yet must not be mistaken for "never seen this event"
    // and resurrected by the pull loop below.
    const localByUid = eventsByListWithUid(list.id);

    let pulled = 0;
    let pushed = 0;

    // Pull.
    for (const [uid, remote] of remoteByUid) {
      const parsed = remote.parsed;
      const local = localByUid.get(uid);
      if (parsed.recurrence) {
        // Recurring: server always wins, no dirty/conflict handling needed.
        eventUpsertFromRemote(list.id, uid, remote.url, remote.etag, {
          title: parsed.title,
          notes: parsed.notes,
          location: parsed.location,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          all_day: parsed.all_day,
          recurrence: parsed.recurrence,
          tags: parsed.tags
        });
        continue;
      }
      if (local?.deleted) {
        // Already deleted locally, just not pushed yet -- don't resurrect it
        // here. The push-delete phase below removes it from the server this
        // same round.
        continue;
      }
      if (!local) {
        const created = eventCreate({
          list_id: list.id,
          title: parsed.title,
          notes: parsed.notes,
          location: parsed.location,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          all_day: parsed.all_day,
          recurrence: parsed.recurrence,
          tags: parsed.tags,
          caldav_uid: uid,
          caldav_href: remote.url,
          caldav_etag: remote.etag,
          dirty: 0
        });
        mergeRemindersFromRemote("event", created.id, parsed.reminderOffsets);
        pulled++;
        continue;
      }
      if (local.caldav_etag !== remote.etag) {
        if (sameEventContent(local, parsed)) {
          syncLog(`event etag-only catchup for "${local.title}" (${uid}): ${local.caldav_etag} -> ${remote.etag}`);
          eventUpdate(local.id, { caldav_href: remote.url, caldav_etag: remote.etag });
          mergeRemindersFromRemote("event", local.id, parsed.reminderOffsets);
          continue;
        }
        if (local.dirty) {
          syncLog(`CONFLICT on event "${local.title}" (${uid}): remote wins, local edits saved as "(conflicted copy)"`);
          const localOffsets = remindersForOwner("event", local.id).map((r) => r.offset_minutes);
          const conflictCopy = eventCreate({
            list_id: list.id,
            title: `${local.title} (conflicted copy)`,
            notes: local.notes,
            location: local.location,
            start_date: local.start_date,
            end_date: local.end_date,
            all_day: local.all_day,
            recurrence: local.recurrence,
            tags: local.tags,
            dirty: 1
          });
          // The copy exists to preserve local edits that hadn't synced yet --
          // that includes any reminders configured locally, not just the
          // core fields above.
          mergeRemindersFromRemote("event", conflictCopy.id, localOffsets);
        } else {
          syncLog(`pull overwrite of clean event "${local.title}" (${uid}): ${local.caldav_etag} -> ${remote.etag}`);
        }
        eventUpdate(local.id, {
          title: parsed.title,
          notes: parsed.notes,
          location: parsed.location,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          all_day: parsed.all_day,
          recurrence: parsed.recurrence,
          tags: parsed.tags,
          caldav_href: remote.url,
          caldav_etag: remote.etag
        });
        mergeRemindersFromRemote("event", local.id, parsed.reminderOffsets);
        pulled++;
      }
    }

    // Push: local events that are new or have unpushed edits, recurring or
    // not. Recurring events are edited/pushed as a whole series -- any edit
    // rewrites the single master VEVENT's RRULE, there's no per-occurrence
    // exception support (RECURRENCE-ID) yet. See docs/roadmap.md "Recurring
    // event editing" for the follow-up if per-occurrence edits are wanted.
    const needEtagRefresh: { id: string; href: string; title: string }[] = [];
    const freshLocalEvents = eventsByList(list.id);
    for (const local of freshLocalEvents) {
      if (!local.caldav_uid) {
        const uid = newUid();
        const offsets = remindersForOwner("event", local.id).map((r) => r.offset_minutes);
        const { ics } = eventToVEvent(local, uid, offsets);
        const filename = `${uid}.ics`;
        try {
          const created = await client.createCalendarObject({
            calendar: { url: calendarUrl } as any,
            filename,
            iCalString: ics
          });
          const href = created.url || `${calendarUrl}${filename}`;
          const etag = created.headers?.get?.("etag") || null;
          eventUpdate(local.id, { caldav_uid: uid, caldav_href: href, caldav_etag: etag } as Partial<CalendarEvent>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, title: local.title });
          // remoteUids was captured before this push, so it doesn't include
          // the object we just created -- without this, eventsPruneMissing
          // below would treat it as "deleted on the server" and hard-delete
          // the event we just successfully pushed.
          remoteUids.add(uid);
          syncLog(`pushed new event "${local.title}" (${uid})${etag ? "" : " — no etag in response"}`);
          pushed++;
        } catch (err: any) {
          syncLog(`push create FAILED for event "${local.title}": ${err?.message || err}`);
        }
      } else {
        if (!local.dirty) continue;
        const remote = remoteByUid.get(local.caldav_uid);
        const remoteEtag = remote?.etag ?? null;
        if (remoteEtag !== local.caldav_etag) {
          syncLog(`push skipped for dirty event "${local.title}": etag moved this round (${local.caldav_etag} vs ${remoteEtag})`);
          continue;
        }
        const offsets = remindersForOwner("event", local.id).map((r) => r.offset_minutes);
        const { ics } = eventToVEvent(local, undefined, offsets);
        const href = local.caldav_href || remote?.url || "";
        try {
          const updated = await client.updateCalendarObject({
            calendarObject: { url: href, data: ics, etag: local.caldav_etag || "" }
          });
          const etag = updated.headers?.get?.("etag") || null;
          eventUpdate(local.id, { caldav_etag: etag || local.caldav_etag } as Partial<CalendarEvent>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, title: local.title });
          syncLog(`pushed update event "${local.title}" (${local.caldav_uid})${etag ? "" : " — no etag in response"}`);
          pushed++;
        } catch (err: any) {
          syncLog(`push update FAILED for event "${local.title}": ${err?.message || err}`);
        }
      }
    }

    if (needEtagRefresh.length) {
      try {
        const fresh = await client.fetchCalendarObjects({
          calendar: { url: calendarUrl } as any,
          objectUrls: needEtagRefresh.map((o) => o.href)
        });
        for (const o of needEtagRefresh) {
          const obj = fresh.find((f) => samePath(f.url, o.href));
          if (obj?.etag) eventUpdate(o.id, { caldav_etag: obj.etag } as Partial<CalendarEvent>);
          syncLog(`etag refresh for event "${o.title}": ${obj?.etag ?? "NOT FOUND"}`);
        }
      } catch (err: any) {
        syncLog(`event etag refresh failed: ${err?.message || err}`);
      }
    }

    // Local deletions (soft-deleted events that were already synced).
    const db = getDb();
    const deletedWithRemote = db
      .prepare(`SELECT * FROM events WHERE list_id = ? AND deleted = 1 AND caldav_uid IS NOT NULL`)
      .all(list.id) as unknown as CalendarEvent[];
    for (const e of deletedWithRemote) {
      try {
        await client.deleteCalendarObject({
          calendarObject: { url: e.caldav_href || "", etag: e.caldav_etag || "" }
        });
      } catch (err: any) {
        syncLog(`event delete FAILED for "${e.title}": ${err?.message || err}`);
      }
      eventDelete(e.id, true);
    }

    eventsPruneMissing(list.id, remoteUids);
    syncLog(`events: synced list "${list.name}" — pulled ${pulled}, pushed ${pushed}`);
  } catch (err: any) {
    syncLog(`events sync FAILED for list "${list.name}": ${err?.message || err}`);
  }
}

async function syncList(client: Client, list: TaskList): Promise<SyncResult> {
  const result: SyncResult = { listId: list.id, pulled: 0, pushed: 0, errors: [] };
  const calendarUrl = list.caldav_calendar_url!;
  syncLog(`--- sync start: list "${list.name}" (${calendarUrl})`);

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
      // TEMP diagnostic -- comparing Tasks Desktop's own pushed VALARM
      // against Thunderbird's, to see why Android isn't firing ours. Remove
      // once resolved.
      if (parsed && (obj.data || "").includes("VALARM")) {
        syncLog(`VALARM-DEBUG task "${parsed.title}":\n${obj.data}`);
      }
    }

    const localTasks = tasksByList(list.id);
    const localByUid = new Map<string, Task>();
    for (const t of localTasks) if (t.caldav_uid) localByUid.set(t.caldav_uid, t);

    // Pull: remote items that are new or changed (by etag) get applied locally.
    for (const [uid, remote] of remoteByUid) {
      const parsed = parseVTodo(remote.data)!;
      const local = localByUid.get(uid);
      if (!local) {
        const created = taskCreate({
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
        mergeRemindersFromRemote("task", created.id, parsed.reminderOffsets);
        result.pulled++;
      } else if (local.caldav_etag !== remote.etag) {
        if (sameContent(local, parsed)) {
          // Same content, different version stamp — usually our own previous
          // push whose PUT response carried no ETag header. Record the etag;
          // there is nothing to pull and nothing left to push.
          syncLog(`etag-only catchup for "${local.title}" (${uid}): ${local.caldav_etag} -> ${remote.etag}`);
          taskUpdate(local.id, { caldav_href: remote.url, caldav_etag: remote.etag });
          mergeRemindersFromRemote("task", local.id, parsed.reminderOffsets);
          continue;
        }
        if (local.dirty) {
          // Both sides changed since the last sync. The remote version wins on
          // the synced task, but the local edits are preserved as a new,
          // unsynced task (which the push phase below uploads), so neither
          // side's work is silently lost.
          syncLog(`CONFLICT on "${local.title}" (${uid}): remote wins, local edits saved as "(conflicted copy)"`);
          const localOffsets = remindersForOwner("task", local.id).map((r) => r.offset_minutes);
          const conflictCopy = taskCreate({
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
          // The copy exists to preserve local edits that hadn't synced yet --
          // that includes any reminders configured locally, not just the
          // core fields above.
          mergeRemindersFromRemote("task", conflictCopy.id, localOffsets);
        } else {
          syncLog(`pull overwrite of clean task "${local.title}" (${uid}): ${local.caldav_etag} -> ${remote.etag}`);
        }
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
        mergeRemindersFromRemote("task", local.id, parsed.reminderOffsets);
        result.pulled++;
      }
    }

    // Push: local items with no UID (new) or modified after last known etag.
    // Servers commonly omit the ETag header on PUT responses; anything pushed
    // without one gets its real etag fetched afterwards (see below) so the
    // next sync doesn't mistake our own upload for a remote change.
    const needEtagRefresh: { id: string; href: string; title: string }[] = [];
    const freshLocalTasks = tasksByList(list.id);
    for (const local of freshLocalTasks) {
      if (local.deleted) continue;
      if (!local.caldav_uid) {
        const uid = newUid();
        const offsets = remindersForOwner("task", local.id).map((r) => r.offset_minutes);
        const { ics } = taskToVTodo(local, uid, offsets);
        const filename = `${uid}.ics`;
        try {
          const created = await client.createCalendarObject({
            calendar: { url: calendarUrl } as any,
            filename,
            iCalString: ics
          });
          const href = created.url || `${calendarUrl}${filename}`;
          const etag = created.headers?.get?.("etag") || null;
          taskUpdate(local.id, {
            caldav_uid: uid,
            caldav_href: href,
            caldav_etag: etag
          } as Partial<Task>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, title: local.title });
          syncLog(`pushed new "${local.title}" (${uid})${etag ? "" : " — no etag in response"}`);
          result.pushed++;
        } catch (err: any) {
          syncLog(`push create FAILED for "${local.title}": ${err?.message || err}`);
          result.errors.push(`Create failed for "${local.title}": ${err?.message || err}`);
        }
      } else {
        // Only push tasks the user actually changed since the last sync.
        // Re-uploading unchanged tasks churns server etags, which makes every
        // OTHER device see a phantom "remote change" and clobber its own
        // pending local edits with stale data.
        if (!local.dirty) continue;
        const remote = remoteByUid.get(local.caldav_uid);
        const remoteEtag = remote?.etag ?? null;
        if (remoteEtag !== local.caldav_etag) {
          // Real content conflicts were already handled in the pull phase.
          syncLog(`push skipped for dirty "${local.title}": etag moved this round (${local.caldav_etag} vs ${remoteEtag})`);
          continue;
        }
        const offsets = remindersForOwner("task", local.id).map((r) => r.offset_minutes);
        const { ics } = taskToVTodo(local, undefined, offsets);
        const href = local.caldav_href || remote?.url || "";
        try {
          const updated = await client.updateCalendarObject({
            calendarObject: {
              url: href,
              data: ics,
              etag: local.caldav_etag || ""
            }
          });
          const etag = updated.headers?.get?.("etag") || null;
          taskUpdate(local.id, {
            caldav_etag: etag || local.caldav_etag
          } as Partial<Task>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, title: local.title });
          syncLog(`pushed update "${local.title}" (${local.caldav_uid})${etag ? "" : " — no etag in response"}`);
          result.pushed++;
        } catch (err: any) {
          syncLog(`push update FAILED for "${local.title}": ${err?.message || err}`);
          result.errors.push(`Update failed for "${local.title}": ${err?.message || err}`);
        }
      }
    }

    // Fetch real etags for anything the server didn't stamp on PUT.
    if (needEtagRefresh.length) {
      try {
        const fresh = await client.fetchCalendarObjects({
          calendar: { url: calendarUrl } as any,
          objectUrls: needEtagRefresh.map((o) => o.href)
        });
        for (const o of needEtagRefresh) {
          const obj = fresh.find((f) => samePath(f.url, o.href));
          if (obj?.etag) taskUpdate(o.id, { caldav_etag: obj.etag } as Partial<Task>);
          syncLog(`etag refresh for "${o.title}": ${obj?.etag ?? "NOT FOUND"}`);
        }
      } catch (err: any) {
        // Non-fatal: the content comparison in the pull phase makes a stale
        // etag self-healing on the next sync.
        syncLog(`etag refresh failed: ${err?.message || err}`);
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
    syncLog(`sync FAILED for list "${list.name}": ${err?.message || err}`);
    result.errors.push(err?.message || String(err));
  }

  syncLog(`--- sync done: list "${list.name}" — pulled ${result.pulled}, pushed ${result.pushed}, errors ${result.errors.length}`);
  return result;
}
