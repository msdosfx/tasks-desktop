# Notes for next session

Written 2026-07-03, end of session.

## UI fixes requested

- "Show scheduled" toggle and "Save view" button in the toolbar-filters row are positioned awkwardly — rework their placement/layout (src/App.tsx toolbar-filters section, styles in src/styles.css).
- Clearing the date should also clear the time (added 2026-07-04).

## Status 2026-07-04 (Linux session)

- v0.1.14 installed on the Linux machine via update-tasksdesktop.sh (script now at ~/.local/bin/update-tasksdesktop); launches cleanly.

## Release notes process (new as of 2026-07-04)

- RELEASE_NOTES.md at repo root is published as the GitHub release body by CI (`body_path` in build.yml).
- Keep it updated as changes land; it always describes the *next* release. Reset it after each tag.

## Session context

- v0.1.13 tagged this session: About dialog (View → About Tasks Desktop), Edit → Settings…, date/time inputs stacked vertically + dark themed (added `color-scheme: dark` and `input[type="time"]` to the dark input rule).
- User runs 0.1.12 installed on Win11; auto-update works from 0.1.9+. v0.1.13 release publishes via CI on tag push.
- Old tags v0.1.10/v0.1.11 exist locally but were deliberately NOT pushed — never `git push --tags` (stale releases would hijack "latest" and break auto-update).
- IMPORTANT: the Cowork sandbox mount can show truncated file tails for recently edited files (caused corrupted commits before v0.1.8). Never commit/build from the sandbox — verify with the file tools (Windows side) and let the user commit from their own terminal.
