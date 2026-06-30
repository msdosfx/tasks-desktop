import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  accountDelete
} from "./db.js";
import { testConnection, discoverCalendars, linkListToCalendar, unlinkList, syncAccount, createServerCalendar, encryptPassword } from "./caldav.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

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
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
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
        { role: "reload" },
        { role: "toggleDevTools" }
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

function registerIpc() {
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
  registerIpc();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});