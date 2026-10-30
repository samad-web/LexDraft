import { useState } from 'react';
import { Icon, Skeleton, ErrorState, EmptyState } from '@lexdraft/ui';
import { useTaskBoard, useMoveTask, useDeleteTask } from '@/hooks/useTasks';
import { useUIStore } from '@/store/ui';
import type { Task, TaskColumn, TaskPriority } from '@lexdraft/types';
import { NewTaskModal } from '@/components/NewTaskModal';
import { FAB } from '@/components/FAB';
import { PageHeader } from '@/components/PageHeader';

interface ColumnDef {
  id: TaskColumn;
  label: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'progress', label: 'In Progress' },
  { id: 'review', label: 'Under Review' },
  { id: 'done', label: 'Done' },
];

function isOverdue(due: string): boolean {
  return new Date(due) < new Date();
}

export function TasksView() {
  const board = useTaskBoard();
  const moveTask = useMoveTask();
  const deleteTask = useDeleteTask();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskColumn | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Two-step confirm on destructive delete. Inline rather than window.confirm
  // because the drawer already has the user's focus - a native dialog would
  // shove that focus to a different layer.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const moveOpenTask = (to: TaskColumn, message: { type: 'sage' | 'cobalt'; text: string }) => {
    if (!openTask) return;
    moveTask.mutate(
      { id: openTask.id, to },
      {
        onError: () => showToast({ type: 'vermillion', text: 'Couldn’t move task' }),
      },
    );
    setOpenTask(null);
    showToast(message);
  };

  const closeDrawer = () => {
    setOpenTask(null);
    setConfirmingDelete(false);
  };

  const deleteOpenTask = () => {
    if (!openTask) return;
    const id = openTask.id;
    deleteTask.mutate(id, {
      onError: () => showToast({ type: 'vermillion', text: 'Couldn’t delete task' }),
      onSuccess: () => showToast({ type: 'sage', text: 'Task deleted' }),
    });
    closeDrawer();
  };

  return (
    <div className="col stagger ct ct-tasks" style={{ gap: 24 }}>
      <PageHeader
        title="Tasks"
        description="Your firm's to-dos on a board. Drag a card to move it."
        actions={
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> New task
          </button>
        }
      />
      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <FAB ariaLabel="New task" onClick={() => setModalOpen(true)}>
        <Icon name="plus" size={22} />
      </FAB>

      {board.isLoading && (
        <div className="ct-board" aria-busy="true" aria-label="Loading task board">
          {COLUMNS.map((col) => (
            <div key={col.id} className="ct-col">
              <div className="ct-col-head">
                <span className="ct-col-title">{col.label}</span>
                <span className="ct-col-count"><Skeleton width={10} height={10} /></span>
              </div>
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="ct-tcard" style={{ cursor: 'default' }}>
                  <Skeleton width={110} height={10} />
                  <Skeleton height={14} />
                  <Skeleton height={14} width="70%" />
                  <Skeleton width={90} height={11} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {board.isError && (
        <ErrorState
          icon="tasks"
          title="Couldn't load the task board"
          description="Check your connection and try again."
        />
      )}

      {board.data && COLUMNS.every((col) => board.data[col.id].length === 0) && (
        <EmptyState
          icon="tasks"
          title="No tasks yet"
          description="Add your first task to start tracking work across pending, in progress, under review, and done."
        />
      )}

      {board.data && !COLUMNS.every((col) => board.data[col.id].length === 0) && (() => {
        const open = board.data.pending.length + board.data.progress.length + board.data.review.length;
        const all = [...board.data.pending, ...board.data.progress, ...board.data.review];
        const today = new Date().toISOString().slice(0, 10);
        const overdueCount = all.filter((t) => isOverdue(t.due) && t.due !== today).length;
        const dueToday = all.filter((t) => t.due === today).length;
        return (
          <div className="ct-kpis is-4">
            <div className="ct-kpi"><span className="ct-kpi-label">Open</span><span className="ct-kpi-value">{open}</span><span className="ct-kpi-note">Pending, in progress, in review</span></div>
            <div className="ct-kpi"><span className="ct-kpi-label">Overdue</span><span className="ct-kpi-value">{overdueCount}</span><span className="ct-kpi-note">Past their due date</span></div>
            <div className="ct-kpi"><span className="ct-kpi-label">Due today</span><span className="ct-kpi-value">{dueToday}</span><span className="ct-kpi-note">{dueToday === 1 ? 'Task' : 'Tasks'} to finish today</span></div>
            <div className="ct-kpi"><span className="ct-kpi-label">Done</span><span className="ct-kpi-value">{board.data.done.length}</span><span className="ct-kpi-note">Approved and closed</span></div>
          </div>
        );
      })()}

      {board.data && !COLUMNS.every((col) => board.data[col.id].length === 0) && (
        <div className="ct-board">
          {COLUMNS.map((col) => {
            const tasks = board.data[col.id];
            return (
              <div
                key={col.id}
                className={`ct-col${overCol === col.id && draggingId ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (overCol !== col.id) setOverCol(col.id); }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={() => {
                  if (draggingId) {
                    moveTask.mutate(
                      { id: draggingId, to: col.id },
                      {
                        onError: () => showToast({ type: 'vermillion', text: 'Couldn’t move task' }),
                      },
                    );
                  }
                  setDraggingId(null);
                  setOverCol(null);
                }}
              >
                <div className="ct-col-head">
                  <span className="ct-col-title">{col.label}</span>
                  <span className="ct-col-count">{tasks.length}</span>
                </div>
                {tasks.length === 0 && <div className="ct-col-empty">Drop a task here</div>}
                {tasks.map((task) => {
                  const dueToday = task.due === new Date().toISOString().slice(0, 10);
                  const overdue = col.id !== 'done' && isOverdue(task.due) && !dueToday;
                  return (
                    <div
                      key={task.id}
                      className={`ct-tcard${draggingId === task.id ? ' is-dragging' : ''}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={() => { setDraggingId(null); setOverCol(null); }}
                      onClick={() => setOpenTask(task)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setOpenTask(task); }}
                    >
                      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                        <span className="ct-tcard-matter" style={{ flex: 1 }}>{task.case}</span>
                        <PriorityMark priority={task.priority} />
                      </div>
                      <div className="ct-tcard-title">{task.title}</div>
                      <div className="ct-tcard-foot">
                        <div className="avatar" title={task.assignee}>{task.assignee}</div>
                        {overdue
                          ? <span className="ct-pill is-ink">Overdue · {fmtDue(task.due)}</span>
                          : dueToday && col.id !== 'done'
                            ? <span className="ct-pill is-strong">Due today</span>
                            : <span className="ct-tcard-due">Due {fmtDue(task.due)}</span>}
                        <span className="spacer" />
                        {task.comments > 0 && (
                          <span className="ct-tcard-cmt" title={`${task.comments} comments`}>
                            <Icon name="chat" size={12} /> {task.comments}
                          </span>
                        )}
                      </div>
                      {/* Touch fallback — see LeadsView for rationale. */}
                      <select
                        aria-label={`Move ${task.title} to a different column`}
                        className="input task-move-select"
                        value={col.id}
                        onChange={(e) => {
                          const to = e.target.value as TaskColumn;
                          if (to === col.id) return;
                          moveTask.mutate(
                            { id: task.id, to },
                            {
                              onError: () =>
                                showToast({ type: 'vermillion', text: "Couldn't move task" }),
                            },
                          );
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {COLUMNS.map((c) => (
                          <option key={c.id} value={c.id}>
                            Move to {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {openTask && (
        <>
          <div className="ct-scrim" onClick={closeDrawer} />
          <aside className="ct-drawer" role="dialog" aria-modal="true" aria-label={openTask.title}>
            <div className="ct-drawer-top">
              <PriorityMark priority={openTask.priority} label />
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeDrawer}
                aria-label="Close"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div>
              <div className="ct-eyebrow">{openTask.case}</div>
              <h2 className="ct-drawer-title" style={{ marginTop: 8 }}>{openTask.title}</h2>
            </div>
            <div className="ct-facts">
              <div className="ct-fact">
                <span className="ct-eyebrow">Assignee</span>
                <span className="ct-fact-value">
                  <span className="avatar">{openTask.assignee}</span>
                  {openTask.assignee}
                </span>
              </div>
              <div className="ct-fact">
                <span className="ct-eyebrow">Due</span>
                <span className="ct-fact-value">
                  {fmtDue(openTask.due)}
                  {openTask.column !== 'done' && isOverdue(openTask.due) && <span className="ct-pill is-ink">Overdue</span>}
                </span>
              </div>
              <div className="ct-fact is-wide">
                <span className="ct-eyebrow">Status</span>
                <span className="ct-fact-value">{COLUMNS.find((c) => c.id === openTask.column)?.label ?? openTask.column}</span>
              </div>
            </div>
            <div className="ct-drawer-block">
              <span className="ct-eyebrow">Description</span>
              <p className="ct-meta" style={{ margin: 0 }}>No description recorded.</p>
            </div>
            <div className="ct-drawer-block">
              <span className="ct-eyebrow">Comments ({openTask.comments})</span>
              <textarea className="input" rows={3} placeholder="Add a comment…" style={{ height: 'auto' }} />
            </div>
            <div className="ct-drawer-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => moveOpenTask('done', { type: 'sage', text: 'Task approved' })}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => moveOpenTask('review', { type: 'cobalt', text: 'Sent for review' })}
              >
                Request Review
              </button>
              <button
                type="button"
                className="btn btn-oxblood"
                onClick={() => moveOpenTask('pending', { type: 'cobalt', text: 'Task returned to pending' })}
              >
                Reject
              </button>
            </div>
            {/* Destructive action - pushed below the workflow buttons and
                gated behind a two-step confirm so a misclick on the drawer
                doesn't drop a task. */}
            <div className="ct-drawer-foot">
              {confirmingDelete ? (
                <div className="col" style={{ gap: 10 }}>
                  <p className="body-sm" style={{ fontWeight: 600, margin: 0 }}>
                    Delete this task? This cannot be undone.
                  </p>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-oxblood"
                      onClick={deleteOpenTask}
                      disabled={deleteTask.isPending}
                    >
                      {deleteTask.isPending ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Icon name="trash" size={13} /> Delete task
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

const PRIORITY_LEVEL: Record<TaskPriority, { n: number; label: string }> = {
  very_high: { n: 4, label: 'Very high' },
  high:      { n: 3, label: 'High' },
  medium:    { n: 2, label: 'Medium' },
  low:       { n: 1, label: 'Low' },
};

/** Priority as four bars filled to the level (monochrome). */
function PriorityMark({ priority, label }: { priority: TaskPriority; label?: boolean }) {
  const p = PRIORITY_LEVEL[priority] ?? PRIORITY_LEVEL.medium;
  return (
    <span className={`ct-prio${p.n === 4 ? ' is-top' : ''}`} title={`${p.label} priority`} aria-label={`${p.label} priority`}>
      <span className="ct-prio-bars" aria-hidden>
        {[1, 2, 3, 4].map((i) => <i key={i} className={i <= p.n ? 'on' : ''} />)}
      </span>
      {(label || p.n === 4) && <span>{p.label}{label ? ' priority' : ''}</span>}
    </span>
  );
}

function fmtDue(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
