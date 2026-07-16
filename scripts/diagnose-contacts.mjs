// Read-only diagnostic for the contacts/address-book sync state.
// Run:  node --experimental-sqlite diagnose-contacts.mjs
// (safe to run while the app is open — it only reads)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
const candidates = [
  { label: "DEV build (electron .)", dir: path.join(APPDATA, "tasks-desktop") },
  { label: "INSTALLED build (Tasks Desktop)", dir: path.join(APPDATA, "Tasks Desktop") }
];

function line() { console.log("-".repeat(70)); }

for (const c of candidates) {
  const dbFile = path.join(c.dir, "tasks-desktop.sqlite3");
  line();
  console.log(`## ${c.label}`);
  console.log(`   ${dbFile}`);
  if (!fs.existsSync(dbFile)) { console.log("   (no database here)"); continue; }

  let db;
  try { db = new DatabaseSync(dbFile, { readOnly: true }); }
  catch (e) { try { db = new DatabaseSync(dbFile); } catch (e2) { console.log("   open failed:", e2.message); continue; } }

  // Address books + per-book contact counts
  console.log("\n   ADDRESS BOOKS:");
  const books = db.prepare(`SELECT * FROM address_books ORDER BY name`).all();
  for (const b of books) {
    const cc = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE address_book_id=? AND deleted=0`).get(b.id).c;
    console.log(`   - "${b.name}"  contacts=${cc}  acct=${b.carddav_account_id ? "yes" : "—"}  ctag=${b.carddav_ctag ? "yes" : "—"}`);
    console.log(`       url: ${b.carddav_addressbook_url || "(local, not synced)"}`);
  }

  // Contact groups (labels stored as CardDAV group cards)
  let groups = [];
  try { groups = db.prepare(`SELECT * FROM contact_groups WHERE deleted=0`).all(); } catch { console.log("\n   (no contact_groups table — old schema)"); }
  console.log(`\n   CONTACT GROUPS (group cards -> labels): ${groups.length}`);
  for (const g of groups) {
    let n = 0; try { n = JSON.parse(g.member_uids || "[]").length; } catch {}
    const bk = books.find((b) => b.id === g.address_book_id);
    console.log(`   - "${g.name}"  members=${n}  in book="${bk ? bk.name : g.address_book_id}"`);
  }

  // Duplicate detection
  const totC = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE deleted=0`).get().c;
  const dupUid = db.prepare(`SELECT carddav_uid, COUNT(*) c FROM contacts WHERE deleted=0 AND carddav_uid IS NOT NULL AND carddav_uid<>'' GROUP BY carddav_uid HAVING c>1`).all();
  const dupName = db.prepare(`SELECT fn, COUNT(*) c FROM contacts WHERE deleted=0 AND fn<>'' GROUP BY LOWER(fn) HAVING c>1 ORDER BY c DESC`).all();
  console.log(`\n   CONTACTS total(live)=${totC}`);
  console.log(`   duplicate UIDs (same person, possibly across books): ${dupUid.length}`);
  console.log(`   duplicate display-names: ${dupName.length}` + (dupName.length ? ` e.g. ${dupName.slice(0,6).map(d=>`"${d.fn}"x${d.c}`).join(", ")}` : ""));

  // Accounts (to see if books are split across accounts)
  try {
    const accts = db.prepare(`SELECT id, label, server_url, carddav_url FROM caldav_accounts`).all();
    console.log(`\n   ACCOUNTS: ${accts.length}`);
    for (const a of accts) console.log(`   - "${a.label}"  carddav_url=${a.carddav_url || a.server_url}`);
  } catch {}

  db.close();
}

// Sync log tail (from whichever build dirs exist)
line();
console.log("## RECENT SYNC LOG (last 40 lines)");
for (const c of candidates) {
  const logFile = path.join(c.dir, "sync.log");
  if (!fs.existsSync(logFile)) continue;
  console.log(`\n   [${c.label}] ${logFile}`);
  const lines = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/);
  for (const l of lines.slice(-40)) console.log("   " + l);
}
line();
console.log("Done. Copy everything above and paste it back.");
