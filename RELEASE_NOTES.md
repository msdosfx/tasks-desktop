Tasks Desktop v0.3.0 — Contacts release

The headline of this release is contacts (CardDAV) support, plus a batch of sync-reliability fixes around duplicate lists, self-signed HTTPS servers, and the Windows taskbar icon.

## Contacts (CardDAV) — new
- A dedicated Contacts tab with a list, detail panel, and a contacts-aware sidebar (address books, favorites, labels with colors).
- Two-way CardDAV sync: create, edit, and delete contacts and have them sync to your server alongside tasks and calendars.
- Birthdays & anniversaries rail, year-less birthdays, per-label colors, search, and label filtering.
- Link a local address book to a remote CardDAV collection, or keep it local-only.

## Self-signed HTTPS servers
- New opt-in setting: "Allow self-signed HTTPS certificates (self-hosted servers)." Turn it on to connect to a self-hosted server using a self-signed cert (e.g. Synology DSM's default HTTPS on your LAN). Off by default; only enable for servers you trust.

## Duplicate lists / contacts — fixed
- Fixed the root cause of duplicate local lists: connecting/disconnecting a server (or switching it between http and https) no longer spawns a second copy of the same list. Remote calendars and address books are now matched by a normalized URL, so an http↔https change is recognized as the same collection.
- Disconnecting a list now keeps it and its tasks but renames it "(local)" so it's clearly distinct from the synced copy — instead of deleting it.
- New "Clean up duplicates" button in Settings merges duplicate lists / address books / contacts left over from earlier connect/disconnect cycles: it keeps one synced copy per collection, renames extras "(local)", and removes identical duplicate contacts. It never deletes your tasks.

## Windows taskbar icon
- The app window now sets its own icon explicitly, so the taskbar shows the Tasks Desktop icon instead of the generic Electron icon regardless of how it's launched.
