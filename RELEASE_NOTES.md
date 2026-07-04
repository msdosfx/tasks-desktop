Changes in this release:

- **Sync fix:** pushed edits could be mistaken for remote changes on the next sync (when the server doesn't return an ETag on upload), causing local edits to be reverted or shunted into "(conflicted copy)" tasks. Sync now fetches the real etag after every push and compares actual content before treating anything as a conflict.
- **Auto-sync:** the app now syncs in the background every 5 minutes by default. Adjustable in Settings (1/5/10/30 minutes, or off). Background syncs are quiet unless something changed or failed.
- **Sync log:** every sync action is recorded in `sync.log` in the app's data folder for troubleshooting.
- **Configurable Sync Now hotkey:** change or disable Ctrl+R in Settings (choices: Ctrl+R, Ctrl+Shift+S, Ctrl+Alt+R, F9, or none). Also fixed the View menu's Reload silently claiming Ctrl+R — Reload is now F5.

- Toolbar: "Hide completed" / "Show scheduled" toggles and "Save view" are now grouped at the right edge of the filter row, and the row wraps cleanly on narrow windows.
- Task details: clearing a start or due date now also clears its time.
- The flatpak update script now ships in the repo (`scripts/update-tasksdesktop.sh`) and is documented in the README.
- README fixes: correct Windows installer filename, accurate auto-update history (broken before 0.1.14), removed stale first-run warning.
