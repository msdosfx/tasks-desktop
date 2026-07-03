import React, { useEffect, useMemo, useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TaskTable from "./components/TaskTable";
import DetailPanel from "./components/DetailPanel";
import ContextMenu from "./components/ContextMenu";
import SettingsModal from "./components/SettingsModal";
import AboutModal from "./components/AboutModal";
import { Task, TaskList, CaldavAccountPublic } from "./types";

type Scope = string | "all" | "today";
type SortMode = "priority" | "due" | "title" | "manual";

/** A saved view: every knob in the toolbar plus the selected scope. */
interface SmartFilter {
  id: string;
  name: string;
  scope: Scope;
  search: string;
  dueFilter: "all" | "today" | "week" | "month";
  categoryFilter: string;
  hideCompleted: boolean;
  showScheduled: boolean;
}

function loadSmartFilters(): SmartFilter[] {
  try { return JSON.parse(localStorage.getItem("smartFilters") || "[]"); } catch { return []; }
}

export default function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accounts, setAccounts] = useState<CaldavAccountPublic[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [forceAddingList, setForceAddingList] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(() => localStorage.getItem("hideCompleted") === "1");
  const [dueFilter, setDueFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showScheduled, setShowScheduled] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => (localStorage.getItem("sortMode") as SortMode) || "priority");
  const [smartFilters, setSmartFilters] = useState<SmartFilter[]>(loadSmartFilters);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  // Set while applying a smart filter so the scope-change effect below doesn't
  // immediately wipe the filter values the smart filter just set.
  const applyingFilterRef = React.useRef(false);

  useEffect(() => {
    localStorage.setItem("hideCompleted", hideCompleted ? "1" : "0");
  }, [hideCompleted]);
  useEffect(() => {
    localStorage.setItem("sortMode", sortMode);
  }, [sortMode]);
  useEffect(() => {
    localStorage.setItem("smartFilters", JSON.stringify(smartFilters));
  }, [smartFilters]);

  // Reset filters when switching lists
  useEffect(() => {
    if (applyingFilterRef.current) { applyingFilterRef.current = false; return; }
    setDueFilter("all"); setCategoryFilter("all");
  }, [scope]);

  function applySmartFilter(f: SmartFilter) {
    applyingFilterRef.current = true;
    setScope(f.scope);
    setSearch(f.search);
    setDueFilter(f.dueFilter);
    setCategoryFilter(f.categoryFilter);
    setHideCompleted(f.hideCompleted);
    setShowScheduled(f.showScheduled);
  }

  function saveCurrentView(name: string) {
    const f: SmartFilter = {
      id: String(Date.now()),
      name: name.trim() || "Untitled filter",
      scope, search, dueFilter, categoryFilter, hideCompleted, showScheduled
    };
    setSmartFilters((prev) => [...prev, f]);
    setSavingView(false);
    setViewName("");
  }

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
      window.api.on("shortcut:open-settings", () => setShowSettings(true)),
      window.api.on("shortcut:open-about", () => setShowAbout(true)),
      window.api.on("notify:select-task", (id: string) => { setScope("all"); setSelectedTaskId(id); })
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
    if (!showScheduled) {
      // "Hide until": tasks whose start date hasn't arrived stay out of sight
      // (Tasks.org behavior). Toggle "Show scheduled" to reveal them.
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      base = base.filter((t) => {
        if (!t.start_date || t.completed) return true;
        return t.start_date.length <= 10 ? t.start_date <= today : new Date(t.start_date) <= now;
      });
    }
    if (categoryFilter !== "all" && scope !== "today") {
      base = base.filter((t) => {
        const cats = (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean);
        return cats.includes(categoryFilter);
      });
    }
    if (dueFilter !== "all" && scope !== "today") {
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
    const prioRank: Record<number, number> = { 1: 0, 5: 1, 9: 2, 0: 3 };
    const byPriority = (a: Task, b: Task) => (prioRank[a.priority] ?? 3) - (prioRank[b.priority] ?? 3);
    const byDue = (a: Task, b: Task) => {
      if (a.due_date === b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    };
    base = [...base].sort((a, b) => {
      if (sortMode === "manual") return a.sort_order - b.sort_order;
      // Completed tasks sink to the bottom in every non-manual mode.
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
      if (sortMode === "priority") {
        return byPriority(a, b) || byDue(a, b) || a.title.localeCompare(b.title);
      }
      if (sortMode === "due") {
        return byDue(a, b) || byPriority(a, b) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
    return base;
  }, [tasks, scope, search, hideCompleted, dueFilter, categoryFilter, showScheduled, sortMode]);

  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tasks) {
      (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => seen.add(c));
    }
    return [...seen].sort();
  }, [tasks]);

  const categoriesInScope = useMemo(() => {
    if (scope === "today") return [];
    if (scope === "all") return allCategories;
    const scopeTasks = tasks.filter((t) => t.list_id === scope);
    const seen = new Set<string>();
    for (const t of scopeTasks) {
      (t.tags || "").split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => seen.add(c));
    }
    return [...seen].sort();
  }, [tasks, scope, allCategories]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const subtasksOfSelected = selectedTask ? tasks.filter((t) => t.parent_id === selectedTask.id) : [];

  function defaultListId(): string {
    if (typeof scope === "string" && scope !== "all" && scope !== "today") return scope;
    return lists[0]?.id;
  }

  /** Drop `draggedId` in front of `targetId` among its visible siblings and
   *  renumber that sibling group. Only touches sort_order, which the DB layer
   *  treats as sync-irrelevant (no dirty flag, nothing re-pushed to CalDAV). */
  async function reorderTask(draggedId: string, targetId: string) {
    const dragged = tasks.find((t) => t.id === draggedId);
    const target = tasks.find((t) => t.id === targetId);
    if (!dragged || !target || dragged.id === target.id) return;
    if ((dragged.parent_id ?? null) !== (target.parent_id ?? null)) return; // siblings only
    const siblings = visibleTasks.filter((t) => (t.parent_id ?? null) === (dragged.parent_id ?? null));
    const ids = siblings.map((t) => t.id).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(targetId), 0, draggedId);
    await Promise.all(
      ids.map((id, i) => {
        const t = siblings.find((x) => x.id === id)!;
        return t.sort_order === i ? Promise.resolve() : window.api.tasks.update(id, { sort_order: i } as Partial<Task>);
      })
    );
    await loadTasks();
  }

  /** Pushes the due date forward. Timed tasks keep their clock time. */
  async function snoozeTask(id: string, until: "tomorrow" | "3days" | "nextweek") {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (until === "tomorrow") base.setDate(base.getDate() + 1);
    else if (until === "3days") base.setDate(base.getDate() + 3);
    else base.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7)); // next Monday
    let due: string;
    if (t.due_date && t.due_date.length > 10) {
      const old = new Date(t.due_date);
      base.setHours(old.getHours(), old.getMinutes(), 0, 0);
      due = base.toISOString();
    } else {
      const pad = (n: number) => String(n).padStart(2, "0");
      due = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
    }
    await window.api.tasks.update(id, { due_date: due } as Partial<Task>);
    await loadTasks();
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
        smartFilters={smartFilters}
        onApplyFilter={applySmartFilter}
        onDeleteFilter={(id) => setSmartFilters((prev) => prev.filter((f) => f.id !== id))}
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
          {scope !== "today" && (<>
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
          <select
            className="due-filter-select"
            value={sortMode}
            title={sortMode === "manual" ? "Drag tasks to reorder them" : "Switch to Manual to drag-reorder tasks"}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="priority">Sort: Priority</option>
            <option value="due">Sort: Due date</option>
            <option value="title">Sort: Title</option>
            <option value="manual">Sort: Manual</option>
          </select>
          <label className="hide-completed-toggle">
            <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
            Hide completed
          </label>
          <label className="hide-completed-toggle" title="Show tasks whose start date is still in the future">
            <input type="checkbox" checked={showScheduled} onChange={(e) => setShowScheduled(e.target.checked)} />
            Show scheduled
          </label>
          {savingView ? (
            <input
              className="save-view-input"
              autoFocus
              placeholder="Filter name… (Enter)"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCurrentView(viewName);
                if (e.key === "Escape") { setSavingView(false); setViewName(""); }
              }}
            />
          ) : (
            <button className="save-view-btn" title="Save the current scope, search, filters and toggles as a smart filter in the sidebar" onClick={() => setSavingView(true)}>
              ☆ Save view
            </button>
          )}
        </div>
        {syncMsg && <div style={{ padding: "4px 16px", fontSize: 12, color: "#9aa0a6" }}>{syncMsg}</div>}
        <TaskTable
          tasks={visibleTasks}
          selectedTaskId={selectedTaskId}
          onSelect={setSelectedTaskId}
          onToggleComplete={toggleComplete}
          dragEnabled={sortMode === "manual"}
          onReorder={reorderTask}
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
            { label: "Snooze until tomorrow", onClick: () => snoozeTask(menu.taskId, "tomorrow") },
            { label: "Snooze 3 days", onClick: () => snoozeTask(menu.taskId, "3days") },
            { label: "Snooze until next week", onClick: () => snoozeTask(menu.taskId, "nextweek") },
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

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
