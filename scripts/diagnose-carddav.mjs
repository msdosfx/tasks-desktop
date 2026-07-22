// Read-only diagnostic: why is CardDAV contact sync not running at all?
// Run:  node --experimental-sqlite scripts\diagnose-carddav.mjs
// (safe while the app is open — reads only)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
const dir = path.join(APPDATA, "tasks-desktop");
const dbFile = path.join(dir, "tasks-desktop.sqlite3");

if (!fs.existsSync(dbFile)) {
  console.log("no database at", dbFile);
  process.exit(0);
}

let db;
try { db = new DatabaseSync(dbFile, { readOnly: true }); }
catch { db = new DatabaseSync(dbFile); }

const line = () => console.log("-".repeat(70));

// 1. Does the hasBooks gate (main.ts:487) pass?
line();
console.log("## ACCOUNT <-> ADDRESS BOOK LINKAGE  (main.ts:487 gate)");
const accounts = db.prepare(`SELECT * FROM caldav_accounts`).all();
const books = db.prepare(`SELECT * FROM address_books ORDER BY sort_order, name`).all();

for (const a of accounts) {
  const linked = books.filter((b) => b.carddav_account_id === a.id && b.carddav_addressbook_url);
  console.log(`\n   account "${a.label}"  id=${a.id}`);
  console.log(`     created_at  = ${a.created_at}   (when this account row was made)`);
  console.log(`     last_sync   = ${a.last_sync_at || "(never)"}  status=${a.last_sync_status || "—"}`);
  console.log(`     server_url  = ${a.server_url || "(none)"}`);
  console.log(`     carddav_url = ${a.carddav_url || "(none)"}`);
  console.log(`     hasBooks gate => ${linked.length ? "PASS — contact sync SHOULD run" : "*** FAIL — contact sync is SKIPPED ***"}`);
  for (const b of linked) console.log(`       linked: "${b.name}"`);
}

console.log("\n   all address books:");
for (const b of books) {
  const orphan = b.carddav_account_id && !accounts.some((a) => a.id === b.carddav_account_id);
  console.log(`   - "${b.name}"  sort=${b.sort_order}  acct_id=${b.carddav_account_id || "(none)"}${orphan ? "  *** POINTS AT A NON-EXISTENT ACCOUNT ***" : ""}`);
}

// 2. Which book would createContact()'s fallback pick? (App.tsx:449 -> addressBooks[0])
line();
const first = books[0];
console.log("## createContact() FALLBACK BOOK  (App.tsx:449 -> addressBooks[0])");
console.log(`   would create into: "${first?.name}"  ->  ${first?.carddav_addressbook_url ? "synced" : "*** LOCAL, NEVER SYNCS ***"}`);

// 3. Contacts that can never reach the server, and contacts stuck dirty.
line();
console.log("## STRANDED / STUCK CONTACTS");
for (const b of books) {
  const live = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE address_book_id=? AND deleted=0`).get(b.id).c;
  if (!live) continue;
  const dirty = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE address_book_id=? AND deleted=0 AND dirty=1`).get(b.id).c;
  const nouid = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE address_book_id=? AND deleted=0 AND carddav_uid IS NULL`).get(b.id).c;
  const synced = !!b.carddav_addressbook_url;
  console.log(`\n   "${b.name}" (${synced ? "synced" : "LOCAL — nothing here can ever push"})`);
  console.log(`     live=${live}  dirty(unpushed edits)=${dirty}  never-pushed(no uid)=${nouid}`);
  if (dirty) {
    const rows = db.prepare(`SELECT fn, carddav_uid, carddav_etag FROM contacts WHERE address_book_id=? AND deleted=0 AND dirty=1 LIMIT 10`).all(b.id);
    for (const r of rows) console.log(`       dirty: "${r.fn}"  uid=${r.carddav_uid || "(none)"}  etag=${r.carddav_etag || "(none)"}`);
  }
  if (!synced) {
    const rows = db.prepare(`SELECT fn FROM contacts WHERE address_book_id=? AND deleted=0 LIMIT 10`).all(b.id);
    for (const r of rows) console.log(`       stranded: "${r.fn}"`);
  }
}

// 4. Has carddav EVER logged, including the rotated log?
line();
console.log("## SYNC LOG: any carddav activity, ever?");
for (const f of ["sync.log", "sync.log.1"]) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log(`   ${f}: (not present)`); continue; }
  const text = fs.readFileSync(p, "utf8");
  const hits = text.split(/\r?\n/).filter((l) => /carddav|contact/i.test(l));
  const size = (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`   ${f} (${size} KB): ${hits.length} carddav/contact line(s)`);
  for (const h of hits.slice(-15)) console.log(`     ${h}`);
}

line();
console.log("Done. Copy everything above and paste it back.");
