// Minimal ambient types for the WebExtension `browser` global, covering only
// the surface area this add-on actually calls. This sandbox has no npm
// registry access, so the real, complete types package could not be
// installed here -- run `npm install --save-dev @types/firefox-webext-browser`
// locally and delete this file once that's in place; its types are more
// complete (and will conflict, hence "delete" rather than "keep both").
declare namespace browser {
  namespace runtime {
    function getURL(path: string): string;
    function sendMessage(message: any): Promise<any>;
    const onMessage: {
      addListener(cb: (message: any, sender: any) => any): void;
      removeListener(cb: (message: any, sender: any) => any): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
    }
    function query(queryInfo: { url?: string }): Promise<Tab[]>;
    function create(createProperties: { url: string }): Promise<Tab>;
    function update(tabId: number, updateProperties: { active?: boolean }): Promise<Tab>;
  }

  namespace windows {
    function update(windowId: number, updateInfo: { focused?: boolean }): Promise<any>;
  }

  namespace action {
    const onClicked: {
      addListener(cb: (tab: tabs.Tab) => void): void;
    };
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }
    function create(name: string, alarmInfo: { periodInMinutes?: number; when?: number }): void;
    const onAlarm: {
      addListener(cb: (alarm: Alarm) => void): void;
    };
  }

  namespace permissions {
    function contains(permissions: { origins?: string[] }): Promise<boolean>;
    function request(permissions: { origins?: string[] }): Promise<boolean>;
  }
}
