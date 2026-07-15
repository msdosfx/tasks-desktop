# Duplicate local lists / triplicate contacts — fix

Applied on the `contacts` branch working tree, 2026-07-15.

## Root cause

The app matched a remote calendar (or address book) to its local copy by **exact
full-URL string**:

```ts
lists.find(l => l.caldav_calendar_url === cal.url)   // SettingsModal
l.caldav_account_id === accountId && l.caldav_calendar_url === calendarUrl  // linkListToCalendar
```

When you toggled the server between `http://` and `https://` (or the port/host
string changed at all — exactly what you were testing), the stored URL no longer
matched what discovery returned. The app then treated the calendar as "not
connected", the dropdown defaulted to **"Connected → create new list"**, and it
made a *fresh* local list while the old one — still linked to the old-scheme URL —
stayed behind orphaned. You were editing those orphaned local lists, so the edits
never synced. Nothing in the database prevented the duplicate either.

The triplicate contacts on the experimental build are the same bug one layer
down: duplicate **address books** each pull a full copy of every contact, so N
duplicate books = N copies of each person.

## What changed (prevention)

All in `electron/` + `src/components/SettingsModal.tsx`:

- **`davUrlKey()`** (in `db.ts`, mirrored in `SettingsModal.tsx`) — normalizes a
  CalDAV/CardDAV URL so `http`↔`https`, trailing slashes, default ports (`:80`/
  `:443`) and host casing all collapse to one key. Every place that matched a
  remote collection to a local one now compares by this key. An `http`↔`https`
  reconnect is recognized as the *same* calendar.
- **`connectCalendar()` / `connectAddressBook()`** — new idempotent "connect"
  path the Settings UI uses instead of blind create+link. If a list/book already
  exists for that collection (by normalized URL) it is **reused** (its stored URL
  refreshed to the current scheme); only if none exists is a new one created.
  This is the single choke point that makes duplicates impossible at the source —
  the server is effectively the source of truth, one local copy per collection.
- **`linkListToCalendar()` / `linkAddressBook()`** now unlink prior copies by
  normalized key too.

## What changed (disconnect behaviour — per your request)

Disconnecting a list used to **delete** it and its local tasks. Now it **unlinks
and renames the list to `"<name> (local)"`**, keeping the tasks, so the local
copy is clearly distinct from the synced one and nothing is silently lost. Same
for address books.

## What changed (clean up the mess you already have)

- **`dedupeDatabase()`** + a **"Clean up duplicates" button** in Settings (next to
  "Save changes"). It:
  - keeps one synced list/address book per remote collection (matched by
    normalized URL) and renames the extra copies `"(local)"` — never deletes a
    list or its tasks;
  - removes exact duplicate contacts sharing the same `(address book, CardDAV
    UID)` — the identical copies from the triplicate bug — keeping the freshest.
  - It's non-destructive to task data and safe to run repeatedly.

To clean your current 3 duplicate lists + triplicate contacts: build the app,
open **Settings → Clean up duplicates**. The orphans become `"… (local)"`; move
anything you still need out of them, then delete the empty `(local)` lists.

## Files touched

`electron/db.ts`, `electron/caldav.ts`, `electron/carddav.ts`, `electron/main.ts`,
`electron/preload.cts`, `src/types.ts`, `src/components/SettingsModal.tsx`.

Verified: `tsc` typechecks cleanly for both the electron and renderer projects.
(The sandbox `npm run build` only fails on a missing Linux rollup native binary —
your Windows `node_modules` has the Windows one, so the build works on your
machine.)

## Save point

A full snapshot of the program *before* these changes is at:
`../tasks-desktop-savepoint-2026-07-15-085119.bak.zip` (source only, no
node_modules). Restore by unzipping over the folder if you want to roll back.

## Git steps (I could not run git — the repo index was locked)

```sh
# review
git diff

# commit on the contacts branch
git add -A
git commit -m "fix: dedupe local lists/books by normalized URL; rename-on-disconnect; cleanup tool"
```

## Porting to `main` (the stable build you run)

`main` is missing **two** things: the HTTPS self-signed-cert fix, and this dedupe
fix.

1. **HTTPS fix** — `https-fix-for-main.patch` in this folder adds just the
   self-signed-cert toggle to `main` (it's currently tangled inside a big contacts
   commit, so it can't be cherry-picked cleanly):

   ```sh
   git checkout main
   git apply https-fix-for-main.patch
   git add -A && git commit -m "Add opt-in self-signed TLS cert toggle"
   ```

2. **Dedupe fix** — the list-side changes apply to `main` too, but `main` has no
   contacts code, so the CardDAV parts must be dropped. Easiest is to land it on
   `contacts`, then merge `contacts → main` when contacts ships. If you want it on
   `main` sooner, tell me and I'll produce a lists-only patch for `main`.
