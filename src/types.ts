export interface TaskList {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  caldav_account_id: string | null;
  caldav_calendar_url: string | null;
  caldav_ctag: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string;
  due_date: string | null;
  start_date: string | null;
  priority: 0 | 1 | 5 | 9;
  completed: 0 | 1;
  completed_at: string | null;
  recurrence: string | null;
  tags: string;
  sort_order: number;
  caldav_uid: string | null;
  caldav_href: string | null;
  caldav_etag: string | null;
  deleted: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CaldavAccountPublic {
  id: string;
  label: string;
  server_url: string;
  username: string;
  principal_url: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

export interface DiscoveredCalendar {
  url: string;
  displayName: string;
  ctag: string | null;
  supportsTodo: boolean;
  color: string | null;
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "High",
  5: "Medium",
  9: "Low"
};

export const PRIORITY_COLORS: Record<number, string> = {
  0: "#6b7280",
  1: "#e5484d",
  5: "#e8a23d",
  9: "#4a90d9"
};

declare global {
  interface Window {
    api: {
      lists: {
        all: () => Promise<TaskList[]>;
        create: (name: string, color?: string) => Promise<TaskList>;
        update: (id: string, patch: Partial<TaskList>) => Promise<TaskList>;
        delete: (id: string) => Promise<void>;
      };
      tasks: {
        all: () => Promise<Task[]>;
        byList: (listId: string) => Promise<Task[]>;
        subtasks: (parentId: string) => Promise<Task[]>;
        create: (input: Partial<Task> & { list_id: string; title: string }) => Promise<Task>;
        update: (id: string, patch: Partial<Task>) => Promise<Task>;
        toggleComplete: (id: string) => Promise<Task>;
        delete: (id: string, hard?: boolean) => Promise<void>;
      };
      accounts: {
        all: () => Promise<CaldavAccountPublic[]>;
        create: (input: { label: string; server_url: string; username: string; password: string }) => Promise<CaldavAccountPublic>;
        update: (id: string, patch: any) => Promise<CaldavAccountPublic>;
        delete: (id: string) => Promise<void>;
        testConnection: (account: any) => Promise<{ ok: boolean; message: string }>;
        discoverCalendars: (accountId: string) => Promise<DiscoveredCalendar[]>;
        linkList: (listId: string, accountId: string, calendarUrl: string) => Promise<void>;
        unlinkList: (listId: string) => Promise<void>;
        sync: (accountId: string) => Promise<{ listId: string; pulled: number; pushed: number; errors: string[] }[]>;
        createServerCalendar: (accountId: string, name: string) => Promise<TaskList>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}
