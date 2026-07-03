import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, shell } from "electron";
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
  accountDelete,
  settingsAll,
  settingSet,
  tasksDueForNotification,
  taskMarkNotified
} from "./db.js";
import { testConnection, discoverCalendars, linkListToCalendar, unlinkList, syncAccount, createServerCalendar, encryptPassword } from "./caldav.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;

const SETTING_DEFAULTS: Record<string, string> = {
  notificationsEnabled: "1",
  reminderTime: "18:00", // when date-only tasks fire
  closeToTray: "1",
  launchAtLogin: "0"
};

function getSetting(key: string): string {
  return settingsAll()[key] ?? SETTING_DEFAULTS[key] ?? "";
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
    backgroundColor: "#1e1f22",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
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

  // "Close to tray": the X button hides the window so reminders keep firing.
  // Quitting is still available from the tray menu (or File > Quit / Cmd+Q).
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
    tray = new Tray(nativeImage.createFromPath(iconPath("32x32.png")));
    tray.setToolTip("Tasks Desktop");
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
  const due = tasksDueForNotification(hh, mm);
  if (due.length === 0) return;
  const icon = nativeImage.createFromPath(iconPath("128x128.png"));
  if (due.length > 3) {
    // One pile-up notification (typically right after launch) instead of a burst.
    const n = new Notification({ title: `${due.length} tasks are due`, body: due.map((t) => t.title).slice(0, 5).join(", ") + (due.length > 5 ? ", …" : ""), icon });
    n.on("click", () => showMainWindow());
    n.show();
    for (const t of due) taskMarkNotified(t.id);
    return;
  }
  for (const t of due) {
    const n = new Notification({ title: t.title, body: `Due ${formatDueForBody(t.due_date!, hh, mm)}`, icon });
    n.on("click", () => {
      showMainWindow();
      mainWindow?.webContents.send("notify:select-task", t.id);
    });
    n.show();
    taskMarkNotified(t.id);
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
        { role: isMac ? "close" : "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
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
        { role: "reload" },
        { role: "toggleDevTools" }
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
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.send("shortcut:sync-now")
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
    return testConnection(full as any);
  });
  ipcMain.handle("accounts:discoverCalendars", async (_e, accountId: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    return discoverCalendars(account);
  });
  ipcMain.handle("accounts:linkList", (_e, listId: string, accountId: string, calendarUrl: string) =>
    linkListToCalendar(listId, accountId, calendarUrl)
  );
  ipcMain.handle("accounts:unlinkList", (_e, listId: string) => unlinkList(listId));
  ipcMain.handle("accounts:createServerCalendar", async (_e, accountId: string, name: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    return createServerCalendar(account, name);
  });
  ipcMain.handle("accounts:sync", async (_e, accountId: string) => {
    const account = accountsAll().find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    const results = await syncAccount(account);
    accountUpdate(accountId, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: results.some((r) => r.errors.length) ? "error" : "ok"
    } as any);
    return results;
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("com.arlis.tasksdesktop"); // required for toasts
  registerIpc();
  buildMenu();
  createWindow();
  setupTray();
  setupAutoUpdater();
  applyLaunchAtLogin(getSetting("launchAtLogin") === "1");

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
