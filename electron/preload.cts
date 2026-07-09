import { contextBridge, ipcRenderer } from "electron";

const api = {
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    installUpdate: () => ipcRenderer.invoke("update:install")
  },
  settings: {
    all: () => ipcRenderer.invoke("settings:all"),
    set: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value)
  },
  lists: {
    all: () => ipcRenderer.invoke("lists:all"),
    create: (name: string, color?: string) => ipcRenderer.invoke("lists:create", name, color),
    update: (id: string, patch: any) => ipcRenderer.invoke("lists:update", id, patch),
    delete: (id: string) => ipcRenderer.invoke("lists:delete", id)
  },
  tasks: {
    all: () => ipcRenderer.invoke("tasks:all"),
    byList: (listId: string) => ipcRenderer.invoke("tasks:byList", listId),
    subtasks: (parentId: string) => ipcRenderer.invoke("tasks:subtasks", parentId),
    create: (input: any) => ipcRenderer.invoke("tasks:create", input),
    update: (id: string, patch: any) => ipcRenderer.invoke("tasks:update", id, patch),
    toggleComplete: (id: string) => ipcRenderer.invoke("tasks:toggleComplete", id),
    delete: (id: string, hard?: boolean) => ipcRenderer.invoke("tasks:delete", id, hard)
  },
  events: {
    all: () => ipcRenderer.invoke("events:all"),
    create: (input: any) => ipcRenderer.invoke("events:create", input),
    update: (id: string, patch: any) => ipcRenderer.invoke("events:update", id, patch),
    delete: (id: string, hard?: boolean) => ipcRenderer.invoke("events:delete", id, hard)
  },
  reminders: {
    for: (ownerType: "task" | "event", ownerId: string) => ipcRenderer.invoke("reminders:for", ownerType, ownerId),
    create: (ownerType: "task" | "event", ownerId: string, offsetMinutes: number) =>
      ipcRenderer.invoke("reminders:create", ownerType, ownerId, offsetMinutes),
    delete: (id: string) => ipcRenderer.invoke("reminders:delete", id)
  },
  accounts: {
    all: () => ipcRenderer.invoke("accounts:all"),
    // Electron has no CORS/host-permission model to satisfy -- see
    // src/types.ts's comment on this method for why it exists at all.
    ensureHostPermission: async (_serverUrl: string) => true,
    create: (input: any) => ipcRenderer.invoke("accounts:create", input),
    update: (id: string, patch: any) => ipcRenderer.invoke("accounts:update", id, patch),
    delete: (id: string) => ipcRenderer.invoke("accounts:delete", id),
    testConnection: (account: any) => ipcRenderer.invoke("accounts:testConnection", account),
    discoverCalendars: (accountId: string) => ipcRenderer.invoke("accounts:discoverCalendars", accountId),
    linkList: (listId: string, accountId: string, calendarUrl: string) =>
      ipcRenderer.invoke("accounts:linkList", listId, accountId, calendarUrl),
    unlinkList: (listId: string) => ipcRenderer.invoke("accounts:unlinkList", listId),
    sync: (accountId: string) => ipcRenderer.invoke("accounts:sync", accountId),
    createServerCalendar: (accountId: string, name: string) => ipcRenderer.invoke("accounts:createServerCalendar", accountId, name)
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    const listener = (_e: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
