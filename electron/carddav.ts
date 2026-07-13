import { createDAVClient } from "tsdav";

type Client = Awaited<ReturnType<typeof createDAVClient>>;
import {
  CaldavAccount,
  AddressBook,
  Contact,
  addressBooksAll,
  addressBookUpdate,
  contactsByBook,
  contactsByBookWithUid,
  contactCreate,
  contactUpdate,
  contactDelete,
  contactsPruneMissing,
  getDb
} from "./db.js";
import { parseVCard, contactToVCard, displayName, ParsedContact } from "./vcard.js";
// Reuse the CalDAV account plumbing: same server credentials + logging.
import { decryptPassword, syncLog } from "./caldav.js";

/** Compare two object URLs by path only (servers report absolute or relative). */
function samePath(a: string, b: string): boolean {
  const p = (u: string) => { try { return new URL(u, "http://x").pathname; } catch { return u; } };
  return p(a) === p(b);
}

async function clientFor(account: CaldavAccount): Promise<Client> {
  return createDAVClient({
    // CardDAV lives at a different address than CalDAV on some servers (e.g.
    // Synology), so prefer the account's dedicated carddav_url when set.
    serverUrl: account.carddav_url || account.server_url,
    credentials: {
      username: account.username,
      password: decryptPassword(account.password_enc)
    },
    authMethod: "Basic",
    defaultAccountType: "carddav"
  });
}

export interface DiscoveredAddressBook {
  url: string;
  displayName: string;
  ctag: string | null;
}

export async function discoverAddressBooks(account: CaldavAccount): Promise<DiscoveredAddressBook[]> {
  const client = await clientFor(account);
  const books = await client.fetchAddressBooks();
  return books.map((b) => ({
    url: String(b.url),
    displayName: String((b as any).displayName || b.url),
    ctag: (b as any).ctag ?? null
  }));
}

/** Link a local address book to a discovered remote one (unlinking any other
 *  local book pointing at the same remote first), mirroring linkListToCalendar. */
export function linkAddressBook(bookId: string, accountId: string, url: string) {
  for (const b of addressBooksAll()) {
    if (b.carddav_account_id === accountId && b.carddav_addressbook_url === url && b.id !== bookId) {
      addressBookUpdate(b.id, { carddav_account_id: null, carddav_addressbook_url: null, carddav_ctag: null } as Partial<AddressBook>);
    }
  }
  addressBookUpdate(bookId, { carddav_account_id: accountId, carddav_addressbook_url: url, carddav_ctag: null } as Partial<AddressBook>);
}

export function unlinkAddressBook(bookId: string) {
  addressBookUpdate(bookId, { carddav_account_id: null, carddav_addressbook_url: null, carddav_ctag: null } as Partial<AddressBook>);
}

// ---------- Contact <-> vCard row mapping ----------
function jsonArr(s: string): any[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

function contactToParsed(c: Contact): ParsedContact {
  return {
    uid: c.carddav_uid,
    fn: c.fn, prefix: c.prefix, first_name: c.first_name, middle_name: c.middle_name,
    last_name: c.last_name, suffix: c.suffix, nickname: c.nickname, org: c.org, title: c.title,
    bday: c.bday, anniversary: c.anniversary, notes: c.notes, categories: c.categories, photo: c.photo,
    phones: jsonArr(c.phones), emails: jsonArr(c.emails), addresses: jsonArr(c.addresses),
    urls: jsonArr(c.urls), impps: jsonArr(c.impps), related: jsonArr(c.related)
  };
}

/** Modeled fields from a parsed vCard, as a Contact patch (arrays -> JSON). */
function parsedToFields(p: ParsedContact): Partial<Contact> {
  return {
    fn: p.fn || displayName(p), prefix: p.prefix, first_name: p.first_name, middle_name: p.middle_name,
    last_name: p.last_name, suffix: p.suffix, nickname: p.nickname, org: p.org, title: p.title,
    bday: p.bday, anniversary: p.anniversary, notes: p.notes, categories: p.categories, photo: p.photo,
    phones: JSON.stringify(p.phones), emails: JSON.stringify(p.emails), addresses: JSON.stringify(p.addresses),
    urls: JSON.stringify(p.urls), impps: JSON.stringify(p.impps), related: JSON.stringify(p.related)
  };
}

/** The modeled fields of a local row, as a patch -- used to build a conflict copy. */
function localFields(c: Contact): Partial<Contact> {
  return {
    fn: c.fn, prefix: c.prefix, first_name: c.first_name, middle_name: c.middle_name, last_name: c.last_name,
    suffix: c.suffix, nickname: c.nickname, org: c.org, title: c.title, bday: c.bday, anniversary: c.anniversary,
    notes: c.notes, categories: c.categories, photo: c.photo, phones: c.phones, emails: c.emails,
    addresses: c.addresses, urls: c.urls, impps: c.impps, related: c.related, raw_vcard: c.raw_vcard
  };
}

function contactSignature(p: ParsedContact): string {
  const norm = (s: string) => (s || "").trim();
  const cats = norm(p.categories).split(",").map((x) => x.trim()).filter(Boolean).sort().join(",");
  return JSON.stringify({
    fn: norm(p.fn), prefix: norm(p.prefix), first: norm(p.first_name), middle: norm(p.middle_name),
    last: norm(p.last_name), suffix: norm(p.suffix), nick: norm(p.nickname), org: norm(p.org),
    title: norm(p.title), bday: p.bday || "", anniversary: p.anniversary || "", notes: norm(p.notes),
    cats, phones: p.phones, emails: p.emails, addresses: p.addresses, urls: p.urls, impps: p.impps, related: p.related
  });
}

/** True when the remote vCard carries the same modeled content as the local
 *  row -- then an etag difference is just a version-stamp move (often our own
 *  last push), not a real remote edit. Photo/raw excluded (encoding varies). */
function sameContactContent(local: Contact, remote: ParsedContact): boolean {
  return contactSignature(contactToParsed(local)) === contactSignature(remote);
}

export interface ContactSyncResult {
  bookId: string;
  pulled: number;
  pushed: number;
  errors: string[];
}

/** Two-way sync for every address book linked to this account. */
export async function syncAccountContacts(account: CaldavAccount): Promise<ContactSyncResult[]> {
  const client = await clientFor(account);
  const books = addressBooksAll().filter((b) => b.carddav_account_id === account.id && b.carddav_addressbook_url);
  const results: ContactSyncResult[] = [];
  for (const book of books) results.push(await syncAddressBook(client, book));
  return results;
}

async function syncAddressBook(client: Client, book: AddressBook): Promise<ContactSyncResult> {
  const result: ContactSyncResult = { bookId: book.id, pulled: 0, pushed: 0, errors: [] };
  const url = book.carddav_addressbook_url!;
  syncLog(`--- carddav sync start: book "${book.name}" (${url})`);

  try {
    const objects = await Promise.race([
      client.fetchVCards({ addressBook: { url } as any }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fetchVCards timed out after 15s")), 15000))
    ]);

    const remoteByUid = new Map<string, { url: string; etag: string; data: string; parsed: ParsedContact }>();
    const remoteUids = new Set<string>();
    for (const obj of objects) {
      const data = obj.data || "";
      const parsed = parseVCard(data);
      if (!parsed || !parsed.uid) continue;
      remoteUids.add(parsed.uid);
      remoteByUid.set(parsed.uid, { url: obj.url, etag: obj.etag || "", data, parsed });
    }

    // Includes soft-deleted rows -- a local delete not yet pushed must not be
    // resurrected by the pull loop below.
    const localByUid = contactsByBookWithUid(book.id);

    // Pull.
    for (const [uid, remote] of remoteByUid) {
      const parsed = remote.parsed;
      const local = localByUid.get(uid);
      if (local?.deleted) continue;
      if (!local) {
        contactCreate({
          address_book_id: book.id,
          ...parsedToFields(parsed),
          raw_vcard: remote.data,
          carddav_uid: uid,
          carddav_href: remote.url,
          carddav_etag: remote.etag,
          dirty: 0
        });
        result.pulled++;
        continue;
      }
      if (local.carddav_etag !== remote.etag) {
        if (sameContactContent(local, parsed)) {
          contactUpdate(local.id, { carddav_href: remote.url, carddav_etag: remote.etag });
          continue;
        }
        if (local.dirty) {
          syncLog(`CONFLICT on contact "${local.fn}" (${uid}): remote wins, local saved as "(conflicted copy)"`);
          contactCreate({
            address_book_id: book.id,
            ...localFields(local),
            fn: `${local.fn} (conflicted copy)`,
            dirty: 1
          });
        } else {
          syncLog(`pull overwrite of clean contact "${local.fn}" (${uid})`);
        }
        contactUpdate(local.id, {
          ...parsedToFields(parsed),
          raw_vcard: remote.data,
          carddav_href: remote.url,
          carddav_etag: remote.etag
        });
        result.pulled++;
      }
    }

    // Push: local contacts that are new or have unpushed edits.
    const needEtagRefresh: { id: string; href: string; name: string }[] = [];
    const freshLocal = contactsByBook(book.id);
    for (const local of freshLocal) {
      if (!local.carddav_uid) {
        const { uid, vcf } = contactToVCard(contactToParsed(local));
        const filename = `${uid}.vcf`;
        const href = `${url}${filename}`;
        try {
          const resp = await client.createVCard({ addressBook: { url } as any, vCardString: vcf, filename });
          const etag = resp.headers?.get?.("etag") || null;
          contactUpdate(local.id, { carddav_uid: uid, carddav_href: href, carddav_etag: etag, raw_vcard: vcf } as Partial<Contact>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, name: local.fn });
          remoteUids.add(uid);
          syncLog(`pushed new contact "${local.fn}" (${uid})${etag ? "" : " — no etag in response"}`);
          result.pushed++;
        } catch (err: any) {
          syncLog(`push create FAILED for contact "${local.fn}": ${err?.message || err}`);
          result.errors.push(`Create failed for "${local.fn}": ${err?.message || err}`);
        }
      } else {
        if (!local.dirty) continue;
        const remote = remoteByUid.get(local.carddav_uid);
        const remoteEtag = remote?.etag ?? null;
        if (remoteEtag !== local.carddav_etag) {
          syncLog(`push skipped for dirty contact "${local.fn}": etag moved this round (${local.carddav_etag} vs ${remoteEtag})`);
          continue;
        }
        const { vcf } = contactToVCard(contactToParsed(local), local.raw_vcard);
        const href = local.carddav_href || remote?.url || "";
        try {
          const resp = await client.updateVCard({ vCard: { url: href, data: vcf, etag: local.carddav_etag || "" } });
          const etag = resp.headers?.get?.("etag") || null;
          contactUpdate(local.id, { carddav_etag: etag || local.carddav_etag, raw_vcard: vcf } as Partial<Contact>);
          if (!etag) needEtagRefresh.push({ id: local.id, href, name: local.fn });
          syncLog(`pushed update contact "${local.fn}" (${local.carddav_uid})${etag ? "" : " — no etag in response"}`);
          result.pushed++;
        } catch (err: any) {
          syncLog(`push update FAILED for contact "${local.fn}": ${err?.message || err}`);
          result.errors.push(`Update failed for "${local.fn}": ${err?.message || err}`);
        }
      }
    }

    // Fetch real etags for anything the server didn't stamp on PUT.
    if (needEtagRefresh.length) {
      try {
        const fresh = await client.fetchVCards({ addressBook: { url } as any, objectUrls: needEtagRefresh.map((o) => o.href) });
        for (const o of needEtagRefresh) {
          const obj = fresh.find((f) => samePath(f.url, o.href));
          if (obj?.etag) contactUpdate(o.id, { carddav_etag: obj.etag } as Partial<Contact>);
        }
      } catch (err: any) {
        syncLog(`contact etag refresh failed: ${err?.message || err}`);
      }
    }

    // Local deletions (soft-deleted contacts that were already synced).
    const db = getDb();
    const deletedWithRemote = db
      .prepare(`SELECT * FROM contacts WHERE address_book_id = ? AND deleted = 1 AND carddav_uid IS NOT NULL`)
      .all(book.id) as unknown as Contact[];
    for (const c of deletedWithRemote) {
      try {
        await client.deleteVCard({ vCard: { url: c.carddav_href || "", etag: c.carddav_etag || "" } });
      } catch (err: any) {
        syncLog(`contact delete FAILED for "${c.fn}": ${err?.message || err}`);
      }
      contactDelete(c.id, true);
    }

    contactsPruneMissing(book.id, remoteUids);
    syncLog(`carddav: synced book "${book.name}" — pulled ${result.pulled}, pushed ${result.pushed}`);
  } catch (err: any) {
    syncLog(`carddav sync FAILED for book "${book.name}": ${err?.message || err}`);
    result.errors.push(err?.message || String(err));
  }

  return result;
}
