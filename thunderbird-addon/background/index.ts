// Background event script -- the replacement for electron/main.ts's
// registerIpc() + BrowserWindow/Menu setup. Channel names are kept identical
// to the original ipcMain.handle() names so tab/api-shim.ts's window.api
// shape (and therefore every React component) needs zero changes.
//
// Important MV3 caveat (confirmed against Thunderbird's docs, TB 128+):
// this is a *non-persistent* "Limited Event Page" -- it is unloaded when
// idle and restarted on the next message/alarm/command event. Nothing here
// may rely on in-memory state surviving between events; getDb() in
// storage.ts already re-initializes safely on demand for that reason, and
// periodic sync is driven by browser.alarms (survives suspension) rather
// than setInterval (would not).
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
} from "./db";
import {
  testConnection,
  discoverCalendars,
  linkListToCalendar,
  unlinkList,
  syncAccount,
  createServerCalendar,
  encodePassword
} from "./caldav";

const TAB_URL = browser.runtime.getURL("tab/index.html");
const SYNC_ALARM = "tasks-desktop-sync";

async function openOrFocusTab(): Promise<void> {
  const tabs = await browser.tabs.query({ url: TAB_URL });
  if (tabs.length && tabs[0].id != null) {
    await browser.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await browser.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url: TAB_URL });
}

browser.action.onClicked.addListener(() => {
  openOrFocusTab();
});

// ---------- Message router ----------
// Every handler below mirrors one ipcMain.handle() call from electron/main.ts.
async function handleChannel(channel: string, args: any[]): Promise<any> {
  switch (channel) {
    case "lists:all":
      return listsAll();
    case "lists:create":
      return listCreate(args[0], args[1]);
    case "lists:update":
      return listUpdate(args[0], args[1]);
    case "lists:delete":
      return listDelete(args[0]);

    case "tasks:all":
      return tasksAll();
    case "tasks:byList":
      return tasksByList(args[0]);
    case "tasks:subtasks":
      return subtasksOf(args[0]);
    case "tasks:create":
      return taskCreate(args[0]);
    case "tasks:update":
      return taskUpdate(args[0], args[1]);
    case "tasks:toggleComplete":
      return taskToggleComplete(args[0]);
    case "tasks:delete":
      return taskDelete(args[0], args[1]);

    case "accounts:all": {
      const accounts = await accountsAll();
      return accounts.map(({ password_enc, ...rest }) => rest);
    }
    case "accounts:create": {
      const input = args[0];
      const created = await accountCreate({ ...input, password_enc: encodePassword(input.password) });
      const { password_enc, ...rest } = created;
      return rest;
    }
    case "accounts:update": {
      const [id, patch] = args;
      const p = { ...patch };
      if (p.password) {
        p.password_enc = encodePassword(p.password);
        delete p.password;
      }
      const updated = await accountUpdate(id, p);
      const { password_enc, ...rest } = updated;
      return rest;
    }
    case "accounts:delete":
      return accountDelete(args[0]);
    case "accounts:testConnection": {
      const account = args[0];
      const all = await accountsAll();
      const full = all.find((a) => a.id === account.id) || { ...account, password_enc: encodePassword(account.password || "") };
      return testConnection(full as any);
    }
    case "accounts:discoverCalendars": {
      const accountId = args[0];
      const all = await accountsAll();
      const account = all.find((a) => a.id === accountId);
      if (!account) throw new Error("Account not found");
      return discoverCalendars(account);
    }
    case "accounts:linkList":
      return linkListToCalendar(args[0], args[1], args[2]);
    case "accounts:unlinkList":
      return unlinkList(args[0]);
    case "accounts:createServerCalendar": {
      const [accountId, name] = args;
      const all = await accountsAll();
      const account = all.find((a) => a.id === accountId);
      if (!account) throw new Error("Account not found");
      return createServerCalendar(account, name);
    }
    case "accounts:sync": {
      const accountId = args[0];
      const all = await accountsAll();
      const account = all.find((a) => a.id === accountId);
      if (!account) throw new Error("Account not found");
      const results = await syncAccount(account);
      await accountUpdate(accountId, {
        last_sync_at: new Date().toISOString(),
        last_sync_status: results.some((r) => r.errors.length) ? "error" : "ok"
      } as any);
      return results;
    }

    default:
      throw new Error(`Unknown channel: ${channel}`);
  }
}

browser.runtime.onMessage.addListener((message: any) => {
  if (!message || typeof message.channel !== "string") return undefined;
  return handleChannel(message.channel, message.args || []);
});

// ---------- Periodic sync ----------
// Runs every 30 minutes; the old Electron "Sync Now" menu item becomes a
// manual trigger the tab sends as a plain "accounts:sync" message per
// account (unchanged from today), this alarm just adds the unattended case.
browser.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  const accounts = await accountsAll();
  for (const account of accounts) {
    try {
      const results = await syncAccount(account);
      await accountUpdate(account.id, {
        last_sync_at: new Date().toISOString(),
        last_sync_status: results.some((r) => r.errors.length) ? "error" : "ok"
      } as any);
    } catch {
      // Best-effort background sync; the tab's manual "Sync Now" surfaces
      // errors properly. A failed unattended sync just tries again next tick.
    }
  }
});

// ---------- Keyboard shortcut ----------
// _execute_action is the one command MV3 wires up for free (opens/focuses
// the tab). Recreating the old File/View/Account/Sync native-menu shortcuts
// (new task, new list, focus search, sync now, open settings) needs either
// more named `commands` entries or the `menus` API -- left for the parity
// pass once the core port is working; today they're inert.
