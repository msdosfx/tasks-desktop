// Repair: re-point address books whose carddav_account_id references an account
// that no longer exists, back at the live account.
//
// Run with the app FULLY QUIT (tray > Quit) — sql.js holds the whole DB in
// memory and writes it back on save, which would clobber this edit.
//
//   node --experimental-sqlite scripts\repair-carddav-link.mjs          (dry run)
//   node --experimental-sqlite scripts\repair-carddav-link.mjs --apply  (writes)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
const dir = path.join(APPDATA, "tasks-desktop");
const dbFile = path.join(dir, "tasks-desktop.sqlite3");

if (!fs.existsSync(dbFile)) { console.log("no database at", dbFile); process.exit(1); }

// Always take our own backup before touching anything.
if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${dbFile}.bak-${stamp}`;
  fs.copyFileSync(dbFile, bak);
  console.log(`backup written: ${bak}\n`);
}

const db = new DatabaseSync(dbFile);
const accounts = db.prepare(`SELECT * FROM caldav_accounts`).all();
const books = db.prepare(`SELECT * FROM address_books`).all();
const liveIds = new Set(accounts.map((a) => a.id));

const orphans = books.filter((b) => b.carddav_account_id && !liveIds.has(b.carddav_account_id));

console.log(`accounts: ${accounts.length}`);
for (const a of accounts) console.log(`  - id=${a.id}  carddav_url=${a.carddav_url || "(none)"}`);
console.log(`\norphaned address books: ${orphans.length}`);
for (const b of orphans) {
  const n = db.prepare(`SELECT COUNT(*) c FROM contacts WHERE address_book_id=? AND deleted=0`).get(b.id).c;
  console.log(`  - "${b.name}"  contacts=${n}  stale acct_id=${b.carddav_account_id}`);
  console.log(`      url: ${b.carddav_addressbook_url || "(none)"}`);
}

if (!orphans.length) { console.log("\nnothing to repair."); process.exit(0); }

if (accounts.length !== 1) {
  console.log(`\n*** ${accounts.length} accounts present — ambiguous. Not repairing automatically.`);
  process.exit(1);
}

const target = accounts[0];
console.log(`\nwould re-point ${orphans.length} book(s) at account ${target.id}`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to make the change.");
  process.exit(0);
}

for (const b of orphans) {
  db.prepare(`UPDATE address_books SET carddav_account_id = ? WHERE id = ?`).run(target.id, b.id);
  console.log(`  relinked "${b.name}"`);
}

// Verify the gate main.ts:487 checks would now pass.
const after = db
  .prepare(`SELECT COUNT(*) c FROM address_books WHERE carddav_account_id = ? AND carddav_addressbook_url IS NOT NULL`)
  .get(target.id).c;
console.log(`\nhasBooks gate now sees ${after} linked book(s) => ${after ? "PASS — contact sync will run" : "STILL FAILING"}`);
