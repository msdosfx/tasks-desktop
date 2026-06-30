import React, { useEffect, useMemo, useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TaskTable from "./components/TaskTable";
import DetailPanel from "./components/DetailPanel";
import ContextMenu from "./components/ContextMenu";
import SettingsModal from "./components/SettingsModal";
import { Task, TaskList, CaldavAccountPublic } from "./types";

type Scope = string | "all" | "today";

export default function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accounts, setAccounts] = useState<CaldavAccountPublic[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [forceAddingList, setForceAddingList] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(() => localStorage.getItem("hideCompleted") === "1");
  const [dueFilter, setDueFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    localStorage.setItem("hideCompleted", hideCompleted ? "1" : "0");
  }, [hideCompleted]);

  // Reset filters when switching lists
  useEffect(() => { setDueFilter("all"); setCategoryFilter("all"); }, [scope]);

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const loadLists = useCallback(async () => setLists(await window.api.lists.all()), []);
  const loadTasks = useCallback(async () => setTasks(await window.api.tasks.all()), []);
  const loadAccounts = useCallback(async () => setAccounts(await window.api.accounts.all()), []);

  useEffect(() => { loadLists(); loadTasks(); loadAccounts(); }, [loadLists, loadTasks, loadAccounts]);

  useEffect(() => {
    const offs = [
      window.api.on("shortcut:new-task", () => createTaskInScope()),
      window.api.on("shortcut:new-list", () => setForceAddingList(true)),
      window.api.on("shortcut:focus-search", () => searchInputRef.current?.focus()),
      window.api.on("shortcut:sync-now", () => runSync()),
      window.api.on("shortcut:open-settings", () => setShowSettings(true))
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedTaskId) { e.preventDefault(); deleteTask(selectedTaskId); }
      }
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        createTaskInScope();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const visibleTasks = useMemo(() => {
    let base = tasks;
    if (scope === "today") {
      const now = new Date();
      base = tasks.filter((t) => {
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        return !t.completed && (due.toDateString() === now.toDateString() || due < now);
      });
      // include parents of matching subtasks for context, and their other subtasks
      const ids = new Set(base.map((t) => t.id));
      const parentIds = new Set(base.map((t) => t.parent_id).filter(Boolean) as string[]);
      base = tasks.filter((t) => ids.has(t.id) || parentIds.has(t.id) || (t.parent_id && ids.has(t.parent_id)));
    } else if (scope !== "all") {
      base = tasks.filter((t) => t.list_id === scope);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchIds = new Set(
        tasks.filter((t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.tags.toLowerCase().includes(q)).map((t) => t.id)
      );
      base = base.filter((t) => matchIds.has(t.id) || (t.parent_id && matchIds.has(t.parent_id)));
    }
    if (hideCompleted) {
      base = base.filter((t) => !t.completed);
    }
    if (categoryFilter !== "all" && scope !== "today" && scope !== "all") {
      base = base.filter((t) => {
        const cats = (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean);
        return cats.includes(categoryFilter);
      });
    }
    if (dueFilter !== "all" && scope !== "today" && scope !== "all") {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfToday); endOfDay.setDate(endOfDay.getDate() + 1);
      const endOfWeek = new Date(startOfToday); endOfWeek.setDate(endOfWeek.getDate() + (7 - startOfToday.getDay()));
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      base = base.filter((t) => {
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        if (dueFilter === "today") return due < endOfDay;
        if (dueFilter === "week") return due < endOfWeek;
        if (dueFilter === "month") return due < endOfMonth;
        return true;
      });
    }
    return base;
  }, [tasks, scope, search, hideCompleted, dueFilter, categoryFilter]);

  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tasks) {
      (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => seen.add(c));
    }
    return [...seen].sort();
  }, [tasks]);

  const categoriesInScope = useMemo(() => {
    if (scope === "all" || scope === "today") return [];
    const scopeTasks = tasks.filter((t) => t.list_id === scope);
    const seen = new Set<string>();
    for (const t of scopeTasks) {
      (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => seen.add(c));
    }
    return [...seen].sort();
  }, [tasks, scope]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const subtasksOfSelected = selectedTask ? tasks.filter((t) => t.parent_id === selectedTask.id) : [];

  function defaultListId(): string {
    if (typeof scope === "string" && scope !== "all" && scope !== "today") return scope;
    return lists[0]?.id;
  }

  async function createTaskInScope() {
    const list_id = defaultListId();
    if (!list_id) return;
    const t = await window.api.tasks.create({ list_id, title: "New task" });
    await loadTasks();
    setSelectedTaskId(t.id);
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    await window.api.tasks.update(id, patch);
    await loadTasks();
  }

  async function toggleComplete(id: string) {
    await window.api.tasks.toggleComplete(id);
    await loadTasks();
  }

  async function deleteTask(id: string) {
    await window.api.tasks.delete(id);
    if (selectedTaskId === id) setSelectedTaskId(null);
    await loadTasks();
  }

  async function addSubtask(parentId: string, title: string) {
    const parent = tasks.find((t) => t.id === parentId);
    if (!parent) return;
    await window.api.tasks.create({ list_id: parent.list_id, parent_id: parentId, title });
    await loadTasks();
  }

  async function createList(name: string) {
    await window.api.lists.create(name);
    await loadLists();
  }

  async function createServerList(name: string, accountId: string) {
    try {
      const newList = await window.api.accounts.createServerCalendar(accountId, name);
      await loadLists();
      setScope(newList.id);
      setSyncMsg(`Created "${name}" on server — syncing…`);
      await syncAccountNow(accountId);
      setSyncMsg(`Created "${name}" on server.`);
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (err: any) {
      setSyncMsg(`Server list creation failed: ${err?.message || err}`);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  }

  async function deleteList(id: string) {
    await window.api.lists.delete(id);
    if (scope === id) setScope("all");
    await loadLists();
    await loadTasks();
  }

  async function removeList(id: string) {
    // Unlink from CalDAV first so no future sync touches the server,
    // then hard-delete the list and its tasks locally.
    const list = lists.find((l) => l.id === id);
    if (list?.caldav_account_id) await window.api.accounts.unlinkList(id);
    await window.api.lists.delete(id);
    if (scope === id) setScope("all");
    await loadLists();
    await loadTasks();
  }

  async function runSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const accounts = await window.api.accounts.all();
      let pulled = 0, pushed = 0, errors: string[] = [];
      for (const acc of accounts) {
        const res = await window.api.accounts.sync(acc.id);
        for (const r of res) { pulled += r.pulled; pushed += r.pushed; errors.push(...r.errors); }
      }
      await loadTasks();
      await loadLists();
      setSyncMsg(errors.length ? `Synced with errors: ${errors[0]}` : `Synced — ${pulled} pulled, ${pushed} pushed.`);
    } catch (err: any) {
      setSyncMsg(err?.message || String(err));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  }

  /** Sync a single account immediately (used right after linking a calendar to a list,
   *  so its tasks show up without waiting for the next manual Sync Now). */
  async function syncAccountNow(accountId: string) {
    const res = await window.api.accounts.sync(accountId);
    await loadTasks();
    await loadLists();
    return res;
  }

  /** Same as syncAccountNow but surfaces a toolbar message — used by the sidebar's
   *  per-list "Sync now" right-click action. */
  async function syncListAccount(accountId: string) {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAccountNow(accountId);
      let pulled = 0, pushed = 0, errors: string[] = [];
      for (const r of res) { pulled += r.pulled; pushed += r.pushed; errors.push(...r.errors); }
      setSyncMsg(errors.length ? `Synced with errors: ${errors[0]}` : `Synced — ${pulled} pulled, ${pushed} pushed.`);
    } catch (err: any) {
      setSyncMsg(err?.message || String(err));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  }

  const scopeTitle =
    scope === "all" ? "All Tasks" : scope === "today" ? "Today & Overdue" : lists.find((l) => l.id === scope)?.name || "Tasks";

  return (
    <div className="app">
      <Sidebar
        lists={lists}
        tasks={tasks}
        accounts={accounts.map((a) => ({ id: a.id, label: a.label }))}
        selectedListId={scope}
        onSelect={setScope}
        onCreateList={createList}
        onCreateServerList={createServerList}
        onDeleteList={deleteList}
        onRemoveList={removeList}
        onSyncList={syncListAccount}
        onOpenSettings={() => setShowSettings(true)}
        onSync={runSync}
        syncing={syncing}
        syncMsg={syncMsg}
        forceAdding={forceAddingList}
        onForceAddingHandled={() => setForceAddingList(false)}
      />

      <div className="main">
        <div className="toolbar">
          <h2>{scopeTitle}</h2>
          <input
            ref={searchInputRef}
            className="search-box"
            placeholder="Search tasks (Ctrl+F)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="primary" onClick={createTaskInScope}>+ New task (Ctrl+N)</button>
        </div>
        <div className="toolbar-filters">
          {scope !== "all" && scope !== "today" && (<>
            <select
              className="due-filter-select"
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)}
            >
              <option value="all">Due: All</option>
              <option value="today">Due: Today</option>
              <option value="week">Due: This week</option>
              <option value="month">Due: This month</option>
            </select>
            {categoriesInScope.length > 0 && (
              <select
                className="due-filter-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">Category: All</option>
                {categoriesInScope.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </>)}
          <label className="hide-completed-toggle">
            <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
            Hide completed
          </label>
        </div>
        {syncMsg && <div style={{ padding: "4px 16px", fontSize: 12, color: "#9aa0a6" }}>{syncMsg}</div>}
        <TaskTable
          tasks={visibleTasks}
          selectedTaskId={selectedTaskId}
          onSelect={setSelectedTaskId}
          onToggleComplete={toggleComplete}
          onContextMenu={(e, taskId) => {
            e.preventDefault();
            setSelectedTaskId(taskId);
            setMenu({ x: e.clientX, y: e.clientY, taskId });
          }}
        />
      </div>

      <DetailPanel
        task={selectedTask}
        lists={lists}
        subtasks={subtasksOfSelected}
        allCategories={allCategories}
        onUpdate={updateTask}
        onDelete={deleteTask}
        onAddSubtask={addSubtask}
        onToggleComplete={toggleComplete}
        onSelectTask={setSelectedTaskId}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Mark complete / incomplete", onClick: () => toggleComplete(menu.taskId) },
            { label: "Duplicate", onClick: async () => {
                const t = tasks.find((x) => x.id === menu.taskId);
                if (t) { await window.api.tasks.create({ list_id: t.list_id, title: `${t.title} (copy)`, notes: t.notes, due_date: t.due_date, priority: t.priority, tags: t.tags }); await loadTasks(); }
              } },
            { label: "Delete", danger: true, onClick: () => deleteTask(menu.taskId) }
          ]}
        />
      )}

      {showSettings && (
        <SettingsModal
          lists={lists}
          onClose={() => setShowSettings(false)}
          onListsChanged={() => { loadLists(); loadTasks(); loadAccounts(); }}
          onSyncAccount={syncAccountNow}
        />
      )}
    </div>
  );
}
