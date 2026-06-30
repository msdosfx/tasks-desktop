import React, { useState, useEffect } from "react";
import { TaskList, Task } from "../types";
import ContextMenu from "./ContextMenu";

interface Props {
  lists: TaskList[];
  tasks: Task[];
  accounts: { id: string; label: string }[];
  selectedListId: string | "all" | "today";
  onSelect: (id: string | "all" | "today") => void;
  onCreateList: (name: string) => void;
  onCreateServerList: (name: string, accountId: string) => Promise<void>;
  onOpenSettings: () => void;
  onSync: () => void;
  syncing: boolean;
  syncMsg?: string | null;
  forceAdding?: boolean;
  onForceAddingHandled?: () => void;
  onDeleteList: (id: string) => void;
  onRemoveList: (id: string) => void;
  onSyncList: (accountId: string) => void;
}

export default function Sidebar({
  lists,
  tasks,
  accounts,
  selectedListId,
  onSelect,
  onCreateList,
  onCreateServerList,
  onOpenSettings,
  onSync,
  syncing,
  syncMsg,
  forceAdding,
  onForceAddingHandled,
  onDeleteList,
  onRemoveList,
  onSyncList
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [listTarget, setListTarget] = useState("local"); // "local" or accountId
  const [listMenu, setListMenu] = useState<{ x: number; y: number; list: TaskList } | null>(null);

  useEffect(() => {
    if (forceAdding) {
      setAdding(true);
      onForceAddingHandled?.();
    }
  }, [forceAdding]);

  const openCount = (listId: string) => tasks.filter((t) => t.list_id === listId && !t.completed && !t.parent_id).length;
  const todayCount = tasks.filter((t) => {
    if (t.completed || !t.due_date) return false;
    const due = new Date(t.due_date);
    const now = new Date();
    return due.toDateString() === now.toDateString() || due < now;
  }).length;

  async function submitNewList() {
    const trimmed = name.trim();
    if (trimmed) {
      if (listTarget !== "local") {
        await onCreateServerList(trimmed, listTarget);
      } else {
        onCreateList(trimmed);
      }
    }
    setName("");
    setListTarget("local");
    setAdding(false);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Tasks Desktop</span>
      </div>
      <div className="sidebar-list">
        <div className={`sidebar-item ${selectedListId === "today" ? "active" : ""}`} onClick={() => onSelect("today")}>
          <span className="sidebar-dot" style={{ background: "#e8a23d" }} />
          <span>Today &amp; Overdue</span>
          {todayCount > 0 && <span className="count">{todayCount}</span>}
        </div>
        <div className={`sidebar-item ${selectedListId === "all" ? "active" : ""}`} onClick={() => onSelect("all")}>
          <span className="sidebar-dot" style={{ background: "#888" }} />
          <span>All Tasks</span>
        </div>
        <div style={{ height: 8 }} />
        {lists.map((l) => (
          <div
            key={l.id}
            className={`sidebar-item ${selectedListId === l.id ? "active" : ""}`}
            style={{ "--accent": l.color } as any}
            onClick={() => onSelect(l.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setListMenu({ x: e.clientX, y: e.clientY, list: l });
            }}
          >
            <span className="sidebar-dot" style={{ background: l.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {l.name}{l.caldav_calendar_url ? " ⇄" : ""}
            </span>
            {openCount(l.id) > 0 && <span className="count">{openCount(l.id)}</span>}
          </div>
        ))}
        {adding ? (
          <div style={{ padding: "6px 14px" }}>
            <input
              autoFocus
              style={{ width: "100%", background: "#26272a", border: "1px solid #34353a", borderRadius: 6, color: "#fff", padding: "4px 6px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewList();
                if (e.key === "Escape") { setAdding(false); setName(""); setListTarget("local"); }
              }}
              onBlur={accounts.length === 0 ? submitNewList : undefined}
            />
            {accounts.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                <select
                  style={{ flex: 1, background: "#26272a", border: "1px solid #34353a", borderRadius: 4, color: "#fff", fontSize: 11, padding: "2px 4px" }}
                  value={listTarget}
                  onChange={(e) => setListTarget(e.target.value)}
                >
                  <option value="local">Local only</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>On server: {a.label}</option>
                  ))}
                </select>
                <button style={{ fontSize: 11, padding: "2px 8px" }} onClick={submitNewList}>Create</button>
              </div>
            )}
          </div>
        ) : (
          <button className="sidebar-add" onClick={() => setAdding(true)}>+ New list</button>
        )}
      </div>
      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now (Ctrl+R)"}</button>
        {syncMsg && <div style={{ fontSize: 11, color: "#9aa0a6", marginTop: 6 }}>{syncMsg}</div>}
        <div style={{ height: 6 }} />
        <button onClick={onOpenSettings}>CalDAV accounts…</button>
      </div>

      {listMenu && (
        <ContextMenu
          x={listMenu.x}
          y={listMenu.y}
          onClose={() => setListMenu(null)}
          items={[
            ...(listMenu.list.caldav_account_id
              ? [{ label: "Sync now", onClick: () => onSyncList(listMenu.list.caldav_account_id!) }]
              : []),
            {
              label: "Remove list",
              danger: true,
              onClick: () => {
                if (confirm(`Remove "${listMenu.list.name}" from this app? Tasks are kept on the server.`)) {
                  onRemoveList(listMenu.list.id);
                }
              }
            },
            {
              label: "Delete list (local only)",
              danger: true,
              onClick: () => {
                if (confirm(`Delete "${listMenu.list.name}"? This removes it and its tasks from this app only — nothing is deleted on the server.`)) {
                  onDeleteList(listMenu.list.id);
                }
              }
            }
          ]}
        />
      )}
    </div>
  );
}
