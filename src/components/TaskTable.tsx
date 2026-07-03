import React from "react";
import { Task, PRIORITY_COLORS } from "../types";

interface Props {
  tasks: Task[]; // already filtered to the current scope, includes subtasks
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
}

function formatDue(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const hasTime = due.length > 10;
  // Date-only tasks aren't overdue during their own day; timed tasks are
  // overdue the moment their time passes.
  const overdue = hasTime ? d < now : d < now && d.toDateString() !== now.toDateString();
  let text = d.toDateString() === now.toDateString() ? "Today" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (hasTime) text += ` ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return { text, overdue };
}

export default function TaskTable({ tasks, selectedTaskId, onSelect, onToggleComplete, onContextMenu }: Props) {
  const topLevel = tasks.filter((t) => !t.parent_id);
  const childrenOf = (id: string) => tasks.filter((t) => t.parent_id === id);

  if (topLevel.length === 0) {
    return <div className="empty-state">No tasks here. Press Ctrl+N to add one.</div>;
  }

  function renderRow(t: Task, depth: number) {
    const due = formatDue(t.due_date);
    const children = childrenOf(t.id);
    return (
      <React.Fragment key={t.id}>
        <div
          className={`task-row ${depth > 0 ? "subtask" : ""} ${t.completed ? "completed" : ""} ${selectedTaskId === t.id ? "selected" : ""}`}
          onClick={() => onSelect(t.id)}
          onContextMenu={(e) => onContextMenu(e, t.id)}
        >
          <span
            className={`checkbox ${t.completed ? "done" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggleComplete(t.id); }}
          />
          {!t.completed && t.priority !== 0 && (
            <span className="priority-dot" style={{ background: PRIORITY_COLORS[t.priority] }} />
          )}
          <div className="title-col">
            <div className="title">{t.title}</div>
            <div className="meta">
              {due && <span className={due.overdue ? "overdue" : ""}>{due.overdue ? "Overdue · " : "Due "}{due.text}</span>}
              {t.recurrence && <span>↻ repeats</span>}
              {t.tags && <span>{t.tags}</span>}
              {children.length > 0 && <span>{children.filter((c) => c.completed).length}/{children.length} subtasks</span>}
            </div>
          </div>
        </div>
        {children.map((c) => renderRow(c, depth + 1))}
      </React.Fragment>
    );
  }

  return <div className="task-table">{topLevel.map((t) => renderRow(t, 0))}</div>;
}
