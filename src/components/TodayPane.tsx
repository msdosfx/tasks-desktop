import { Task, TaskList } from "../types";

interface Props {
  tasks: Task[];
  lists: TaskList[];
  onSelectTask: (id: string) => void;
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return dateStr.slice(0, 10) === todayStr;
}

/** Thunderbird's Today Pane only shows things *starting* today. This one
 *  shows tasks due today and/or starting today (per the user's request) --
 *  a task can appear once even if both are true today. */
export default function TodayPane({ tasks, lists, onSelectTask }: Props) {
  const colorFor = (listId: string) => lists.find((l) => l.id === listId)?.color || "#4a90d9";
  const today = tasks
    .filter((t) => !t.completed && !t.deleted && (isToday(t.due_date) || isToday(t.start_date)))
    .sort((a, b) => (a.due_date || a.start_date || "").localeCompare(b.due_date || b.start_date || ""));

  return (
    <div className="today-pane">
      <h3>Today</h3>
      {today.length === 0 && <p className="today-pane-empty">Nothing due or starting today.</p>}
      <ul className="today-pane-list">
        {today.map((t) => {
          const due = isToday(t.due_date);
          const starts = isToday(t.start_date);
          const label = due && starts ? "starts & due" : due ? "due" : "starts";
          return (
            <li key={t.id} onClick={() => onSelectTask(t.id)}>
              <span className="today-pane-dot" style={{ background: colorFor(t.list_id) }} />
              <span className="today-pane-title">{t.title}</span>
              <span className="today-pane-label">{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
