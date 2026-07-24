import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, shell, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
import {
  listsAll,
  listCreate,
  listUpdate,
  listDelete,
  tasksAll,
  tasksByList,
  taskCreate,
  taskUpdate,
  taskToggleComplete,
  taskDelete,
  subtasksOf,
  accountsAll,
  accountCreate,
  accountUpdate,
  davRepairOrphanedLinks,
  accountDelete,
  settingsAll,
  settingSet,
  eventsAll,
  eventCreate,
  eventUpdate,
  eventDelete,
  remindersForOwner,
  reminderCreateForOwner,
  reminderDeleteForOwner,
  remindersDueForNotification,
  reminderMarkFired,
  addressBooksAll,
  addressBookCreate,
  addressBookUpdate,
  addressBookDelete,
  contactsAll,
  contactsAllForUi,
  contactsByBook,
  contactCreate,
  contactUpdate,
  contactDelete,
  contactsMerge,
  dedupeDatabase
} from "./db.js";
import { testConnection, discoverCalendars, linkListToCalendar, unlinkList, syncAccount, createServerCalendar, encryptPassword, connectCalendar, syncLog } from "./caldav.js";
import { discoverAddressBooks, linkAddressBook, unlinkAddressBook, syncAccountContacts, connectAddressBook, importVCards } from "./carddav.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
// The experimental build is packaged with productName "Tasks Desktop (Experimental)",
// so electron-builder names its exe/install dir accordingly. Detect it from the exe
// path (no build-time flag needed) so it can wear the distinct orange icon + identity,
// the same way dev runs do — handy since it shares the stable app's database.
const isExperimental = /experimental/i.test(app.getPath("exe"));
// Runs that should look distinct from an installed production build (orange icon).
const isDistinctBuild = isDev || isExperimental;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;

const SETTING_DEFAULTS: Record<string, string> = {
  notificationsEnabled: "1",
  reminderTime: "18:00", // when date-only tasks fire
  closeToTray: "0", // off by default: the X button really quits; opt in via settings
  launchAtLogin: "0",
  syncIntervalMinutes: "60", // background auto-sync; matches Tasks.org's default; "0" = manual only
  syncHotkey: "CmdOrCtrl+R", // accelerator for Sync Now; "" = no hotkey
  allowInsecureCerts: "0" // opt-in: accept self-signed TLS certs (self-hosted LAN servers)
};

function getSetting(key: string): string {
  return settingsAll()[key] ?? SETTING_DEFAULTS[key] ?? "";
}

/** Opt-in acceptance of self-signed certificates for self-hosted servers on the
 *  LAN (e.g. Synology DSM's default HTTPS cert on :5001). Off by default; when
 *  on it turns off TLS verification for the app's Node fetches (undici honors
 *  NODE_TLS_REJECT_UNAUTHORIZED via tls.connect), so it's clearly labeled in
 *  Settings. Applied at startup and whenever the toggle changes. */
function applyTlsSetting() {
  if (getSetting("allowInsecureCerts") === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
}

function showMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 520,
    title: "Tasks Desktop",
    // Explicit window icon so the taskbar button always shows the app icon
    // regardless of how the exe was launched (installed shortcut, portable
    // unpacked exe, or dev). Without this, Windows falls back to the generic
    // Electron icon when no matching AppUserModelID shortcut is registered.
    icon: nativeImage.createFromPath(iconPath(isDistinctBuild ? "32x32-dev.png" : "256x256.png")),
    backgroundColor: "#1e1f22",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Right-click Cut/Copy/Paste on inputs (and Copy on any selected text).
  mainWindow.webContents.on("context-menu", (_e, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push({ role: "copy" }, { type: "separator" }, { role: "selectAll" });
    }
    if (template.length && mainWindow) Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // "Close to tray" (opt-in, off by default): when enabled in settings, the X
  // button hides the window so reminders keep firing. When disabled, closing
  // the window quits the app. Quitting is always available from the tray menu
  // and File > Exit.
  mainWindow.on("close", (e) => {
    if (!isQuiting && getSetting("closeToTray") === "1") {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function iconPath(name: string): string {
  return path.join(app.getAppPath(), "build", "icons", name);
}

function setupTray() {
  try {
    // Dev/experimental runs use a distinct orange icon file (build/icons/32x32-dev.png)
    // so they're never confused with an installed production build at a glance.
    tray = new Tray(nativeImage.createFromPath(iconPath(isDistinctBuild ? "32x32-dev.png" : "32x32.png")));
    tray.setToolTip(isDev ? "Tasks Desktop (dev)" : isExperimental ? "Tasks Desktop (Experimental)" : "Tasks Desktop");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Tasks Desktop", click: () => showMainWindow() },
      { type: "separator" },
      { label: "Quit", click: () => { isQuiting = true; app.quit(); } }
    ]));
    tray.on("click", () => showMainWindow());
    tray.on("double-click", () => showMainWindow());
  } catch (err) {
    console.error("[tray] failed to create tray icon:", err);
  }
}

/** app.setLoginItemSettings covers Windows/macOS; on Linux we write (or
 *  remove) a freedesktop autostart entry instead. */
function applyLaunchAtLogin(enabled: boolean) {
  if (process.platform === "linux") {
    try {
      const dir = path.join(os.homedir(), ".config", "autostart");
      const file = path.join(dir, "tasks-desktop.desktop");
      if (enabled) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]
Type=Application
Name=Tasks Desktop
Exec="${process.execPath}"
X-GNOME-Autostart-enabled=true
`);
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error("[autostart] failed:", err);
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
}

// ---------- Reminders ----------
function parseReminderTime(): { hh: number; mm: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(getSetting("reminderTime"));
  if (!m) return { hh: 18, mm: 0 };
  return { hh: Math.min(23, Number(m[1])), mm: Math.min(59, Number(m[2])) };
}

function formatDueForBody(due: string, hh: number, mm: number): string {
  const d = new Date(due.length <= 10 ? `${due}T00:00:00` : due);
  if (due.length <= 10) d.setHours(hh, mm, 0, 0);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function checkReminders() {
  if (getSetting("notificationsEnabled") !== "1" || !Notification.isSupported()) return;
  const { hh, mm } = parseReminderTime();
  const due = remindersDueForNotification(hh, mm);
  if (due.length === 0) return;
  const icon = nativeImage.createFromPath(iconPath("128x128.png"));
  if (due.length > 3) {
    // One pile-up notification (typically right after launch) instead of a burst.
    const n = new Notification({ title: `${due.length} reminders`, body: due.map((r) => r.title).slice(0, 5).join(", ") + (due.length > 5 ? ", …" : ""), icon });
    n.on("click", () => showMainWindow());
    n.show();
    for (const r of due) reminderMarkFired(r.reminderId);
    return;
  }
  for (const r of due) {
    const n = new Notification({ title: r.title, body: `${r.ownerType === "task" ? "Due" : "Starts"} ${formatDueForBody(r.due, hh, mm)}`, icon });
    n.on("click", () => {
      showMainWindow();
      mainWindow?.webContents.send(r.ownerType === "task" ? "notify:select-task" : "notify:select-event", r.ownerId);
    });
    n.show();
    reminderMarkFired(r.reminderId);
  }
}

/** Combine the sync logs (current + rotated) with a short diagnostics header
 *  into one text file the user can save and share. No credentials are included
 *  -- just app/version/platform, the data-folder path, and list/account counts.
 *  Reveals the saved file in the OS file manager. */
async function exportLogs() {
  try {
    const dir = app.getPath("userData");
    const parts: string[] = [
      "Tasks Desktop diagnostics",
      `Generated:   ${new Date().toISOString()}`,
      `App version: ${app.getVersion()}`,
      `Platform:    ${process.platform} ${process.arch}`,
      `User data:   ${dir}`
    ];
    try {
      const lists = listsAll();
      parts.push(`Lists:       ${lists.length} (linked to a server: ${lists.filter((l) => l.caldav_calendar_url).length})`);
      parts.push(`Accounts:    ${accountsAll().length}`);
    } catch { /* non-fatal */ }
    parts.push("");
    let anyLog = false;
    for (const name of ["sync.log.1", "sync.log"]) {
      try {
        const content = fs.readFileSync(path.join(dir, name), "utf8");
        parts.push(`===== ${name} =====`, content, "");
        anyLog = true;
      } catch { /* file may not exist */ }
    }
    if (!anyLog) parts.push("(no sync log has been written yet)");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: "Export Logs",
      defaultPath: path.join(app.getPath("desktop"), `tasks-desktop-logs-${stamp}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    if (res.canceled || !res.filePath) return;
    fs.writeFileSync(res.filePath, parts.join("\n"), "utf8");
    shell.showItemInFolder(res.filePath);
  } catch (err: any) {
    dialog.showErrorBox("Export Logs failed", String(err?.message || err));
  }
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Task",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("shortcut:new-task")
        },
        {
          label: "New List",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => mainWindow?.webContents.send("shortcut:new-list")
        },
        { type: "separator" },
        ...(isMac
          ? [{ role: "close" as const }]
          : [{
              label: "Exit",
              click: () => { isQuiting = true; app.quit(); }
            }])
      ]
    },
    {
      label: "Edit",
      submenu: [
        {
          // App-level undo (restores the last task action: delete, edit,
          // complete-toggle, create, snooze, reorder). registerAccelerator is
          // false so the renderer's focus-aware keydown owns Ctrl/Cmd+Z —
          // that keeps native undo working inside text fields while typing.
          // The accelerator is still shown here for discoverability, and
          // clicking the item dispatches the same undo.
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          registerAccelerator: false,
          click: () => mainWindow?.webContents.send("shortcut:undo")
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Settings…",
          click: () => mainWindow?.webContents.send("shortcut:open-settings")
        }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Find / Search",
          accelerator: "CmdOrCtrl+F",
          click: () => mainWindow?.webContents.send("shortcut:focus-search")
        },
        { type: "separator" },
        // Explicit F5: the role's default (CmdOrCtrl+R) collided with Sync Now.
        { role: "reload", accelerator: "F5" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "About Tasks Desktop",
          click: () => mainWindow?.webContents.send("shortcut:open-about")
        }
      ]
    },
    {
      label: "Account",
      submenu: [
        {
          label: "CalDAV Accounts…",
          accelerator: "CmdOrCtrl+,",
          click: () => mainWindow?.webContents.send("shortcut:open-settings")
        }
      ]
    },
    {
      label: "Sync",
      submenu: [
        {
          label: "Sync Now",
          // Configurable so it can be changed/disabled on hotkey conflicts.
          ...(getSetting("syncHotkey") ? { accelerator: getSetting("syncHotkey") } : {}),
          click: () => mainWindow?.webContents.send("shortcut:sync-now")
        },
        { type: "separator" },
        {
          label: "Export Logs…",
          click: () => { exportLogs(); }
        },
        {
          label: "Open Logs Folder",
          click: () => { shell.openPath(app.getPath("userData")); }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Auto-update (Windows/NSIS only). deb/flatpak installs update through the
 *  package manager or a manual download, and electron-updater can't help there. */
function setupAutoUpdater() {
  if (!app.isPackaged || process.platform !== "win32") return;
  const send = (state: string, detail?: unknown) =>
    mainWindow?.webContents.send("update:status", state, detail);
  autoUpdater.on("checking-for-update", () => send("checking"));
  autoUpdater.on("update-available", (info: any) => send("available", info.version));
  autoUpdater.on("update-not-available", () => send("none"));
  autoUpdater.on("download-progress", (p: any) => send("downloading", Math.round(p.percent)));
  autoUpdater.on("update-downloaded", (info: any) => send("downloaded", info.version));
  autoUpdater.on("error", (err: any) => send("error", err?.message || String(err)));
  autoUpdater.checkForUpdates().catch(() => {});
}

function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());

  ipcMain.handle("settings:all", () => ({ ...SETTING_DEFAULTS, ...settingsAll() }));
  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    settingSet(key, value);
    if (key === "launchAtLogin") applyLaunchAtLogin(value === "1");
    if (key === "syncHotkey") buildMenu(); // apply new accelerator immediately
    if (key === "allowInsecureCerts") applyTlsSetting();
  });

  ipcMain.handle("lists:all", () => listsAll());
  ipcMain.handle("lists:create", (_e, name: string, color?: string) => listCreate(name, color));
  ipcMain.handle("lists:update", (_e, id: string, patch: any) => listUpdate(id, patch));
  ipcMain.handle("lists:delete", (_e, id: string) => listDelete(id));

  ipcMain.handle("tasks:all", () => tasksAll());
  ipcMain.handle("tasks:byList", (_e, listId: string) => tasksByList(listId));
  ipcMain.handle("tasks:subtasks", (_e, parentId: string) => subtasksOf(parentId));
  ipcMain.handle("tasks:create", (_e, input: any) => taskCreate(input));
  ipcMain.handle("tasks:update", (_e, id: string, patch: any) => taskUpdate(id, patch));
  ipcMain.handle("tasks:toggleComplete", (_e, id: string) => taskToggleComplete(id));
  ipcMain.handle("tasks:delete", (_e, id: string, hard?: boolean) => taskDelete(id, hard));

  ipcMain.handle("events:all", () => eventsAll());
  ipcMain.handle("events:create", (_e, input: any) => eventCreate(input));
  ipcMain.handle("events:update", (_e, id: string, patch: any) => eventUpdate(id, patch));
  ipcMain.handle("events:delete", (_e, id: string, hard?: boolean) => eventDelete(id, hard));

  ipcMain.handle("addressbooks:all", () => addressBooksAll());
  ipcMain.handle("addressbooks:create", (_e, name: string, color?: string) => addressBookCreate(name, color));
  ipcMain.handle("addressbooks:update", (_e, id: string, patch: any) => addressBookUpdate(id, patch));
  ipcMain.handle("addressbooks:delete", (_e, id: string) => addressBookDelete(id));
  ipcMain.handle("addressbooks:discover", async (_e, accountId: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    return discoverAddressBooks(account);
  });
  ipcMain.handle("addressbooks:link", (_e, bookId: string, accountId: string, url: string) => linkAddressBook(bookId, accountId, url));
  // Idempotent connect: reuse the existing linked book (matched by normalized
  // URL) rather than creating a duplicate that would triplicate contacts.
  ipcMain.handle("addressbooks:connect", (_e, accountId: string, url: string, displayName: string) =>
    connectAddressBook(accountId, url, displayName)
  );
  ipcMain.handle("addressbooks:unlink", (_e, bookId: string) => unlinkAddressBook(bookId));

  ipcMain.handle("contacts:all", () => contactsAllForUi());
  ipcMain.handle("contacts:byBook", (_e, bookId: string) => contactsByBook(bookId));
  ipcMain.handle("contacts:create", (_e, input: any) => contactCreate(input));
  ipcMain.handle("contacts:update", (_e, id: string, patch: any) => contactUpdate(id, patch));
  ipcMain.handle("contacts:delete", (_e, id: string, hard?: boolean) => contactDelete(id, hard));
  ipcMain.handle("contacts:import", async (_e, opts: { label: string; bookId: string; createNew: boolean }) => {
    const res = await dialog.showOpenDialog({
      title: "Import contacts from vCard",
      filters: [{ name: "vCard", extensions: ["vcf", "vcard"] }],
      properties: ["openFile"]
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const text = fs.readFileSync(res.filePaths[0], "utf8");
    const summary = importVCards(text, opts);
    return { canceled: false, ...summary };
  });
  ipcMain.handle("contacts:merge", (_e, keeperId: string, loserIds: string[], patch: any) => contactsMerge(keeperId, loserIds, patch));

  ipcMain.handle("reminders:for", (_e, ownerType: "task" | "event", ownerId: string) => remindersForOwner(ownerType, ownerId));
  ipcMain.handle("reminders:create", (_e, ownerType: "task" | "event", ownerId: string, offsetMinutes: number) =>
    reminderCreateForOwner(ownerType, ownerId, offsetMinutes)
  );
  ipcMain.handle("reminders:delete", (_e, id: string) => reminderDeleteForOwner(id));

  ipcMain.handle("accounts:all", () => accountsAll().map(({ password_enc, ...rest }) => rest));
  ipcMain.handle("accounts:create", (_e, input: any) => {
    const created = accountCreate({ ...input, password_enc: encryptPassword(input.password) });
    const { password_enc, ...rest } = created;
    return rest;
  });
  ipcMain.handle("accounts:update", (_e, id: string, patch: any) => {
    const p = { ...patch };
    if (p.password) {
      p.password_enc = encryptPassword(p.password);
      delete p.password;
    }
    const updated = accountUpdate(id, p);
    const { password_enc, ...rest } = updated;
    return rest;
  });
  ipcMain.handle("accounts:delete", (_e, id: string) => accountDelete(id));
  ipcMain.handle("accounts:testConnection", async (_e, account: any) => {
    const full = accountsAll().find((a) => a.id === account.id) || { ...account, password_enc: encryptPassword(account.password || "") };
    const cal = await testConnection(full as any);
    // Also probe CardDAV address books -- uses carddav_url, else falls back to
    // server_url in clientFor -- so testing a draft (before the account is
    // saved) already reports address books if the URL is a contacts endpoint.
    // Silent on failure (a plain CalDAV URL just isn't a CardDAV collection).
    let books = "";
    try {
      const found = await discoverAddressBooks(full as any);
      if (found.length > 0) books = ` Found ${found.length} address book(s).`;
    } catch { /* not a CardDAV endpoint / unreachable — omit */ }
    return { ok: cal.ok, message: cal.message + books };
  });
  ipcMain.handle("accounts:discoverCalendars", async (_e, accountId: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    return discoverCalendars(account);
  });
  ipcMain.handle("accounts:linkList", (_e, listId: string, accountId: string, calendarUrl: string) =>
    linkListToCalendar(listId, accountId, calendarUrl)
  );
  // Idempotent connect: reuses an existing list for this calendar (matched by
  // normalized URL) instead of ever creating a duplicate local list.
  ipcMain.handle("accounts:connectCalendar", (_e, accountId: string, calendarUrl: string, displayName: string, color?: string | null) =>
    connectCalendar(accountId, calendarUrl, displayName, color)
  );
  ipcMain.handle("accounts:unlinkList", (_e, listId: string) => unlinkList(listId));
  // One-shot cleanup of duplicate lists / address books / contacts already in
  // the database (the http<->https reconnect fallout). Non-destructive to tasks.
  ipcMain.handle("maintenance:dedupe", (_e, dryRun?: boolean) => dedupeDatabase(!!dryRun));
  ipcMain.handle("accounts:createServerCalendar", async (_e, accountId: string, name: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    return createServerCalendar(account, name);
  });
  ipcMain.handle("accounts:sync", async (_e, accountId: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    const results = await syncAccount(account);
    // Also sync contacts, but only if this account has a linked address book --
    // avoids opening a CardDAV client (and a spurious error) on calendar-only
    // accounts. Contact results fold into the same list the UI aggregates.
    const hasBooks = addressBooksAll().some((b) => b.carddav_account_id === accountId && b.carddav_addressbook_url);
    if (hasBooks) {
      try {
        const contactResults = await syncAccountContacts(account);
        for (const r of contactResults) results.push({ listId: r.bookId, pulled: r.pulled, pushed: r.pushed, errors: r.errors });
      } catch (err: any) {
        // Must reach sync.log AND the UI. Swallowing this into console.error
        // hid a completely dead contact sync for eight days -- the packaged
        // build has no console anyone reads.
        const msg = err?.message || String(err);
        syncLog(`carddav sync FAILED for account "${account.label}": ${msg}`);
        results.push({ listId: "", pulled: 0, pushed: 0, errors: [`Contact sync failed: ${msg}`] });
      }
    } else {
      // A silent skip here is indistinguishable from "nothing to do", which is
      // exactly how the orphaned-book bug stayed invisible. Say why.
      const books = addressBooksAll().filter((b) => b.carddav_addressbook_url);
      syncLog(
        `carddav: skipped account "${account.label}" — no linked address book ` +
          `(${books.length} book(s) have a URL but none point at this account id ${accountId})`
      );
    }
    accountUpdate(accountId, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: results.some((r) => r.errors.length) ? "error" : "ok"
    } as any);
    return results;
  });
}

app.whenReady().then(() => {
  // Distinct AppUserModelID in dev so a raw `electron .` run doesn't register a
  // shortcut under the packaged app's identity — that collision is what made
  // Windows show the Electron icon on the installed app's taskbar button.
  if (process.platform === "win32") app.setAppUserModelId(isDev ? "com.arlis.tasksdesktop.dev" : isExperimental ? "com.arlis.tasksdesktop.experimental" : "com.arlis.tasksdesktop"); // required for toasts; matches the experimental build's appId so its taskbar button/toasts stay separate from stable
  // Heal links left pointing at a deleted account before any sync runs. This
  // state is invisible in the UI -- the list/book still looks connected -- but
  // every sync gate skips it, so it fails 100% silently until someone reads
  // the database. Cheap to check, so check every launch.
  for (const l of davRepairOrphanedLinks()) syncLog(`startup: ${l}`);

  registerIpc();
  buildMenu();
  createWindow();
  setupTray();
  setupAutoUpdater();
  applyLaunchAtLogin(getSetting("launchAtLogin") === "1");
  applyTlsSetting();

  // First reminder pass shortly after launch (catches anything that came due
  // while the app was off), then once a minute.
  setTimeout(checkReminders, 5000);
  setInterval(checkReminders, 60_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => { isQuiting = true; });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
