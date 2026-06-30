import { contextBridge, ipcRenderer } from "electron";

const api = {
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
  accounts: {
    all: () => ipcRenderer.invoke("accounts:all"),
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
