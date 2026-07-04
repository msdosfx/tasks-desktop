# Notes for next session

Written 2026-07-03, end of session.

## UI fixes requested

- "Show scheduled" toggle and "Save view" button in the toolbar-filters row are positioned awkwardly — rework their placement/layout (src/App.tsx toolbar-filters section, styles in src/styles.css).

## Session context

- v0.1.13 tagged this session: About dialog (View → About Tasks Desktop), Edit → Settings…, date/time inputs stacked vertically + dark themed (added `color-scheme: dark` and `input[type="time"]` to the dark input rule).
- User runs 0.1.12 installed on Win11; auto-update works from 0.1.9+. v0.1.13 release publishes via CI on tag push.
- Old tags v0.1.10/v0.1.11 exist locally but were deliberately NOT pushed — never `git push --tags` (stale releases would hijack "latest" and break auto-update).
- IMPORTANT: the Cowork sandbox mount can show truncated file tails for recently edited files (caused corrupted commits before v0.1.8). Never commit/build from the sandbox — verify with the file tools (Windows side) and let the user commit from their own terminal.
