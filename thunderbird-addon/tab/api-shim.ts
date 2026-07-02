// Replacement for electron/preload.cts's contextBridge-exposed window.api.
// Same shape, same call sites -- every React component calls
// window.api.tasks.create() etc. exactly as before. Only the transport
// changed: ipcRenderer.invoke(channel, ...args) -> a runtime.sendMessage
// envelope of { channel, args }, handled by background/index.ts's
// handleChannel() switch.
function call(channel: string, ...args: any[]): Promise<any> {
  return browser.runtime.sendMessage({ channel, args });
}

const api = {
  lists: {
    all: () => call("lists:all"),
    create: (name: string, color?: string) => call("lists:create", name, color),
    update: (id: string, patch: any) => call("lists:update", id, patch),
    delete: (id: string) => call("lists:delete", id)
  },
  tasks: {
    all: () => call("tasks:all"),
    byList: (listId: string) => call("tasks:byList", listId),
    subtasks: (parentId: string) => call("tasks:subtasks", parentId),
    create: (input: any) => call("tasks:create", input),
    update: (id: string, patch: any) => call("tasks:update", id, patch),
    toggleComplete: (id: string) => call("tasks:toggleComplete", id),
    delete: (id: string, hard?: boolean) => call("tasks:delete", id, hard)
  },
  accounts: {
    all: () => call("accounts:all"),
    // Must run in the tab (this file), not proxied through the background
    // script via call() -- browser.permissions.request() requires a user
    // gesture (transient activation), which does not survive a
    // runtime.sendMessage hop. This is why SettingsModal calls it directly
    // before testConnection/create/sync rather than it being folded
    // invisibly into those.
    //
    // Deliberately skips a browser.permissions.contains() pre-check: that
    // call is itself async, and awaiting it before ever calling request()
    // burns the click's transient activation window, producing "permissions
    // request may only be called from a user input handler" even though
    // this function is invoked directly from a button's onClick. request()
    // is safe to call unconditionally -- it resolves true immediately,
    // without prompting, when the permission is already granted.
    ensureHostPermission: (serverUrl: string): Promise<boolean> => {
      // Match patterns need a wildcard path ("/*"), not just a trailing
      // slash -- "http://host/" only matches the literal root path, which
      // is why CalDAV requests to /caldav/ or /.well-known/caldav kept
      // getting CORS-blocked even after the permission prompt was accepted.
      let origin: string;
      try {
        origin = new URL(serverUrl).origin + "/*";
      } catch {
        return Promise.resolve(false); // Let the real API call fail with its own clearer error.
      }
      return browser.permissions.request({ origins: [origin] });
    },
    create: (input: any) => call("accounts:create", input),
    update: (id: string, patch: any) => call("accounts:update", id, patch),
    delete: (id: string) => call("accounts:delete", id),
    testConnection: (account: any) => call("accounts:testConnection", account),
    discoverCalendars: (accountId: string) => call("accounts:discoverCalendars", accountId),
    linkList: (listId: string, accountId: string, calendarUrl: string) =>
      call("accounts:linkList", listId, accountId, calendarUrl),
    unlinkList: (listId: string) => call("accounts:unlinkList", listId),
    sync: (accountId: string) => call("accounts:sync", accountId),
    createServerCalendar: (accountId: string, name: string) => call("accounts:createServerCalendar", accountId, name)
  },
  // electron/preload.cts's "on" wired native-menu IPC events
  // (shortcut:new-task etc.) sent from electron/main.ts's Menu callbacks.
  // Thunderbird has no equivalent native File/View menu for an extension tab,
  // so this currently only delivers messages the background script proactively
  // pushes via runtime.sendMessage({ event, args }) -- none does yet (see
  // background/index.ts's shortcut comment). Kept so App.tsx's window.api.on()
  // calls keep compiling unchanged; they're just inert until that follow-up.
  on: (channel: string, callback: (...args: any[]) => void) => {
    const listener = (message: any) => {
      if (message && message.event === channel) callback(...(message.args || []));
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }
};

(window as any).api = api;
