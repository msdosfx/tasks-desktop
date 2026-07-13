# Contacts (CardDAV) — feature research & build plan

Status: **planning** (no code yet). Target: a Contacts module alongside Tasks &
Calendar, syncing over **CardDAV** (contacts' equivalent of CalDAV — same
servers: Synology, Nextcloud, any DAVx5-compatible host; `tsdav` already speaks
it, and `ical.js` parses/generates vCard).

---

## 1. Feature research (what the named apps actually do)

### Nextcloud Contacts
- vCard **3.0 and 4.0** support (import limited to 3.0/4.0).
- **Auto-generated Birthday calendar**: pulls `BDAY` (and anniversaries) from
  contacts into a **read-only** calendar; the only way to edit it is by editing
  the contact's birthday. Also surfaces anniversaries.
- Calendar reminders on events (birthday calendar itself is read-only, so its
  reminders aren't directly editable — a known limitation users complain about).
- Multiple, **shareable** address books.
- Integrates with Calendar and Mail.
- Community-requested gaps worth noting: **birthdays without a year**, and
  showing contact birthdays in *any* calendar.

### Birday (Android) — the model you like
- Simple **events timeline**: next date + name per person.
- **Event types**: birthday, anniversary, name day, death anniversary, "other".
- **Notifications**: day-of (with selectable time, optional grouping of same-day
  events) **plus up to 21 days before**, multiple lead-time selections.
- **Favorite / normal / ignored** system; optional per-event note.
- **Import** from contacts or calendar with **duplicate detection**; auto-import
  on launch with a conflict strategy.
- **Backup/restore** in native / CSV / JSON.
- Age / "turns N" implied by the timeline.

### Synology Contacts
- Provides a **CardDAV server**; syncs to any CardDAV client + iOS.
- **Multiple, shareable** address books with per-privilege sharing.
- **Labels** for organization.
- **Import/export** vCard (.vcf) and Google CSV; import from Google/Outlook.
- Deduplication on import.

### Thunderbird address book
- Moving all storage to the **industry-standard vCard** format (since TB 102).
- **Mailing lists / groups** (a contact needs an email to join a list).
- **Tags/categories** for filtering.
- Contact **photos** (via add-ons like Gravatar/Libravatar).
- Import/export CSV and vCard.
- Per-contact colors (the "per-category color" idea we deferred lives here too).

---

## 2. Consolidated feature set (organized into tiers)

### Core contact fields (vCard 3.0/4.0)
- Structured name (prefix / first / middle / last / suffix) + display name (`FN`)
- Nickname (`NICKNAME`)
- **Multiple typed phone numbers** (`TEL`: mobile/home/work/fax/main/other)
- **Multiple typed emails** (`EMAIL`)
- **Multiple typed postal addresses** (`ADR`, structured)
- Organization / department / job title / role (`ORG`, `TITLE`, `ROLE`)
- **Birthday** (`BDAY`) and **Anniversary** (`ANNIVERSARY`) — incl. **year-less**
- Websites (`URL`), instant-messaging / social (`IMPP`, `X-SOCIALPROFILE`)
- Notes (`NOTE`)
- Categories / labels (`CATEGORIES`)
- Photo / avatar (`PHOTO`)
- Related people (`RELATED`: spouse, child, etc.)
- **Raw-vCard passthrough** for any field we don't model (see architecture) so a
  round-trip never drops data.

### CardDAV sync
- Multiple **address books** (mirrors lists/calendars in the app).
- Two-way sync with the **same dirty / etag / conflict-copy model** as tasks/events.
- Address-book discovery via `tsdav` (reuses the existing account credentials).

### Birthday / anniversary → calendar (Nextcloud + Birday)
- Auto-derived **yearly all-day events** from `BDAY` / `ANNIVERSARY` (+ custom
  event types: name day, death anniversary, "other" — Birday parity).
- **Reminders**: day-of (configurable time) **and N days before** (Birday-style,
  multiple leads).
- **Year-less birthdays** supported (no age shown).
- **Age / "turns N"** label when a year is known.
- Shown on the existing calendar (reusing the recurring-occurrence renderer we
  just built) and surfaced in the **Today pane** as "upcoming birthdays".

### Organization & browse
- Groups / mailing lists **and** flat categories/labels.
- **Favorite / ignored** (Birday).
- Search across name/org/email/phone/notes; sort (name, upcoming birthday).

### Import / export
- Import **.vcf** (3.0/4.0) and **CSV** (Google/Outlook mappings).
- Export **.vcf**.
- **Duplicate detection / merge** on import (Birday/Synology parity).

---

## 3. Additional features worth considering (my recommendations)

- **Link contacts to tasks** — assign a task to a person; already floated in the
  roadmap and a natural fit given the shared CalDAV/CardDAV account.
- **Click-to-act**: `mailto:` an email, `tel:` a phone, open an address in maps.
- **"Upcoming birthdays" Today-pane section** with age and days-until.
- **Contact colors** (Thunderbird) — folds in the per-category-color idea we shelved.
- **Merge duplicates** UI (not just on import).
- **Timezone per contact** (`TZ`) — handy for scheduling across zones.
- **Backup/restore** of the whole contacts DB in JSON (Birday parity, and a nice
  safety net given this app's beta status).
- **vCard version choice**: default to **3.0 on the wire** for maximum
  compatibility (Synology, DAVx5, iOS), upgrading to 4.0 only if a server wants it.
- **Anniversary/other custom recurring personal events** beyond birthdays.
- Deliberately **out of scope** (no mail client): mailing-list *sending*,
  frequently-contacted ranking, Gravatar fetching (privacy).

---

## 4. Architecture

Mirrors the tasks/events stack so the sync machinery and UI patterns are reused.

**Data model (SQLite)**
- `address_books` (like `lists`): id, name, color, carddav account/url/ctag.
- `contacts`: id, address_book_id, `uid`, `fn`, structured-name parts, `bday`,
  `anniversary`, `org`, `title`, `notes`, `categories`, `photo` (base64 or a
  cached file path), **JSON columns** for the multi-value sets (`phones`,
  `emails`, `addresses`, `urls`, `impps`, `related`), plus `carddav_href/etag`,
  `dirty`, `deleted`, `sequence`, timestamps — **and a `raw_vcard` column** that
  preserves the untouched server vCard so unknown properties survive a
  round-trip (we re-emit modeled fields over the raw card on push).
- Optional `contact_groups` for mailing-list/group membership.

**vCard layer** (`electron/vcard.ts`, mirroring `ical.ts`)
- `contactToVCard()` / `parseVCard()` using `ical.js`'s vCard support; merge
  modeled fields onto the preserved raw card on write.

**Sync engine** (`electron/carddav.ts`, mirroring `caldav.ts`)
- Per-address-book two-way sync with etag/dirty/conflict-copy handling; discovery
  reuses the existing account.

**Birthday calendar** — recommended: **client-side generated, read-only** (like
Nextcloud's, and like the recurring ghost bars we just built): compute yearly
occurrences from contacts at render time, draw on the calendar, fire reminders
locally. Avoids polluting the CalDAV calendar; optional setting later to also
push them as real events. (Decision needed — see §6.)

**UI**
- New **Contacts** tab beside Tasks/Calendar; contact list + detail panel
  (reusing detail-panel patterns), address books in the sidebar.
- Today-pane "upcoming birthdays" section.

**IPC** — `contacts:*`, `addressbooks:*`, `carddav:sync`, mirroring the events IPC
(which we confirmed passes patches straight through).

---

## 5. Phased build plan (incremental, build-checked, one commit each)

1. **Data model + vCard round-trip**: schema (`address_books`, `contacts`),
   `vcard.ts` parse/generate, standalone round-trip test (like the recurring
   ical test). Raw-vCard passthrough included from the start.
2. **CardDAV sync engine**: `carddav.ts` + address-book discovery + IPC; verify
   against your Synology/Nextcloud.
3. **Contacts UI**: list, detail/edit panel, sidebar address books, create/edit/
   delete, search/sort.
4. **Birthday & anniversary integration**: reconcile contacts' `BDAY`/
   `ANNIVERSARY` into **managed yearly VEVENTs with VALARM reminders** on a
   dedicated "Birthdays" calendar, synced so Thunderbird / Etar / Tasks.org
   remind natively; **setting, default ON**; keep events in step with contacts
   (create/update/remove on change); **Today-pane Birday-style controls**
   (upcoming with age + days-until, per-birthday extra reminder lead-times);
   year-less birthdays + age handling.
5. **Import/export + dedupe**: .vcf and CSV import with duplicate detection, .vcf
   export, JSON backup/restore.
6. **Polish**: photos, groups/mailing lists, favorite/ignored, contact colors,
   link-to-task, click-to-email/call.

Each phase builds on the last; phases 1–2 are the risky/foundational ones, 3–4
deliver the visible value, 5–6 are additive.

---

## 6.5. Phase 3 UI refinements (user notes 2026-07-12)

Make the Contacts view a proper contacts workspace, laid out like Thunderbird /
Synology Contacts:
1. **Left column shows address books** when the Contacts tab is active (context-
   aware sidebar — address books instead of task lists/calendars), clicking one
   filters the list to that book. This replaces the toolbar Book dropdown.
2. **"CalDAV accounts" → "CardDAV accounts"** labeling in the Contacts context;
   the account/settings affordance surfaces CardDAV linking there.
3. **Today pane shows groups/labels** (distinct `CATEGORIES` across contacts)
   when in Contacts view; clicking a label filters the list. *(Done separately:
   a label filter dropdown also lives in the main toolbar.)*
4. **Label filter in the main panel toolbar** — DONE.
5. **Search matches** first name, last name, nickname, phone numbers, email
   addresses (plus display name, org, labels) — DONE.

Also done 2026-07-12: separate **`carddav_url`** on the account (Synology hosts
CardDAV at a different address than CalDAV) — schema + `carddav.ts` client +
renderer type; the account-settings CardDAV section (phase 3b) collects it.

Still to build: context-aware sidebar (address books), Today-pane labels,
CardDAV account/link UI in Settings.

## 6. Decisions (resolved 2026-07-12)

1. **Birthdays** (DECIDED — materialize real events): `BDAY` stays a normal
   editable contact field (syncs to Android/Synology/Nextcloud contacts). On top
   of that, the app **generates a real yearly all-day VEVENT with VALARM
   reminder(s)** from each birthday, on a managed "Birthdays" calendar, so
   Thunderbird / Etar / Tasks.org fire native reminders — no dependence on
   Birday. This is a **setting, default ON**. The generated events are
   app-managed (regenerated when the contact's birthday changes; not hand-edited
   on the calendar). The **Today pane** gets **Birday-style controls**: upcoming
   birthdays with age + days-until, and per-birthday additional reminder
   lead-times (day-of at a set time + N days before, multiple).
   - Sub-decisions still open: (a) which calendar/list the generated events land
     on — a dedicated auto-created "Birthdays" list linked to CalDAV is the plan;
     (b) default reminder lead-times (proposed: 9:00 AM day-of + 1 day before).
   - Since they're real recurring events, they also appear on our own calendar
     for free (via the occurrence renderer) — no separate display path needed.
2. **Photos**: yes — store and display contact avatars.
3. **Groups vs. labels**: start with **labels/categories** only — a flat tag set
   on each contact (`CATEGORIES`). This is exactly how Nextcloud and Synology
   implement "groups" under the hood, so it round-trips cleanly to your servers.
   True `KIND:group` container vCards (Apple-style groups with a membership list)
   deferred to later polish.
4. **vCard version**: 3.0 on the wire.
5. **Branch**: fresh `contacts` branch off `main`, created once experimental
   testing is done so it doesn't disturb the running dev build.
