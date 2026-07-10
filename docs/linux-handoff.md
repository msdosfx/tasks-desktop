# Linux machine handoff

Written 2026-07-04 (Windows session). Read together with `next-session-notes.md`.

## State of the repo

- `main` has one unpushed commit + tag **v0.1.14**: the Windows auto-update fix.
  If Arlis hasn't pushed yet, push from a normal terminal (never from the Cowork sandbox):

  ```
  git push origin main
  git push origin v0.1.14
  ```

- What v0.1.14 fixes:
  - **Auto-update was broken in every version.** electron-builder named the installer
    `Tasks Desktop Setup <ver>.exe` (spaces). GitHub renames uploaded assets: spaces → **dots**
    (`Tasks.Desktop.Setup...`). electron-updater's GitHub provider replaces spaces with
    **dashes** (`Tasks-Desktop-Setup...`) → 404 → silent `error` event. Fixed via
    `build.win.artifactName: "${name}-Setup-${version}.${ext}"` in package.json → space-free
    `tasks-desktop-Setup-0.1.14.exe`. Installed 0.1.12 should auto-update to 0.1.14 with no
    manual step once the release is up (quit fully, reopen, wait for background download,
    quit again to install).
  - X button now really quits (`closeToTray` default flipped to "0"; tray behavior is opt-in
    via settings). File > Exit is an explicit quit item on Windows/Linux.

- Folder cleanup on the Windows machine: two project folders exist,
  `Tasks.org Desktop` (space — stale, only node_modules, safe to delete) and
  `Tasks.org-Desktop` (dash — the real repo).

## How flatpak updating works (current state)

The in-app updater does **nothing** on Linux: `setupAutoUpdater()` returns unless
`win32` + NSIS. electron-updater has no flatpak support at all.

Flatpak itself only auto-updates apps installed **from a remote (repo)** — e.g. Flathub or a
self-hosted OSTree repo. Our CI publishes a standalone **`.flatpak` bundle** on GitHub
releases; bundle installs have no update channel, so `flatpak update` never finds anything.

Current update path is the manual script at repo-sibling `update-tasksdesktop.sh`:

```
gh release download --repo precisioncrab/tasks-desktop --pattern '*.flatpak' --dir "$TMP"
flatpak install --reinstall -y "$TMP"/*.flatpak
```

(Requires `gh` CLI; app id is `com.arlis.tasksdesktop`.)

## Options for real flatpak auto-update (to decide/implement on Linux)

1. **Keep the script, reduce friction** (least work): install it to `~/.local/bin`, optionally
   add a systemd user timer to run it daily. No infra. Downside: still out-of-band.
2. **Self-host a flatpak repo on GitHub Pages** (middle ground): CI runs
   `flatpak build-export` into an OSTree repo, publishes it via Pages; machines run
   `flatpak remote-add` once, then normal `flatpak update` (and GNOME Software) picks up new
   versions automatically. Needs GPG signing of the repo and a CI rework of the flatpak job.
3. **Publish on Flathub** (most polish): true auto-updates via software centers, but requires
   a public manifest repo, Flathub review, and giving up the release-asset workflow for Linux.

Small orthogonal improvement: on Linux the app could still *check* the GitHub latest release
on launch (plain HTTPS to `releases/latest`, compare versions) and show an "update available"
note in settings pointing to the script — the IPC plumbing (`update:status`) already exists.

## Verify on the Linux machine

1. `git pull` (after the push above) — confirm `git log --oneline -1` shows the v0.1.14 commit.
2. Run `./update-tasksdesktop.sh` once v0.1.14's release is published; confirm
   `flatpak info com.arlis.tasksdesktop` reports 0.1.14.
3. Check the X button now quits the app and File > Exit exists.

## Sandbox rules (repeat from next-session-notes.md)

- Never `git push`/build from the Cowork sandbox (no GitHub network access; historical file
  truncation issue). Commit contents were verified complete this session (`git show HEAD:...`
  + tsc clean) — but always re-verify tails after sandbox edits.
