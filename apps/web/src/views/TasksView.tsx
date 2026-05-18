import { useState } from 'react';
import { Icon, Skeleton } from '@lexdraft/ui';
import { useTaskBoard, useMoveTask, useDeleteTask } from '@/hooks/useTasks';
import { useUIStore } from '@/store/ui';
import type { Task, TaskColumn, TaskPriority } from '@lexdraft/types';
import { NewTaskModal } from '@/components/NewTaskModal';

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

/** Priority value → existing dot color class (kept named after the color so
 *  other consumers of the dot system are unaffected). */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  very_high: 'vermillion',
  high:      'amber',
  medium:    'cobalt',
  low:       'sage',
};

function isOverdue(due: string): boolean {
  return new Date(due) < new Date();
}

export function TasksView() {
  const board = useTaskBoard();
  const moveTask = useMoveTask();
  const deleteTask = useDeleteTask();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
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
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Kanban board · drag to move</div>
          <h1 className="heading-xl">Tasks</h1>
        </div>
        <span className="spacer" />
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> New task
        </button>
      </div>
      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {board.isLoading && (
        <div
          className="kanban"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 16,
          }}
          aria-busy="true"
          aria-label="Loading task board"
        >
          {COLUMNS.map((col) => (
            <div
              key={col.id}
              style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                minHeight: 420,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div className="row">
                <span className="eyebrow">{col.label}</span>
                <span className="spacer" />
                <Skeleton width={20} height={14} />
              </div>
              <div className="col" style={{ gap: 10 }}>
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="card"
                    style={{
                      background: 'var(--bg-base)',
                      padding: 'var(--space-4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Skeleton width={8} height={8} circle />
                      <Skeleton width={80} height={11} />
                    </div>
                    <Skeleton height={14} />
                    <Skeleton height={14} width="70%" />
                    <Skeleton width={90} height={11} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {board.isError && (
        <div className="card">
          <p className="body-md" style={{ color: 'var(--danger)' }}>
            Couldn&apos;t load the task board. Please try again.
          </p>
        </div>
      )}

      {board.data && (
        <div
          className="kanban"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {COLUMNS.map((col) => {
            const tasks = board.data[col.id];
            return (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
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
                }}
                style={{
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  minHeight: 420,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div className="row">
                  <span className="eyebrow">{col.label}</span>
                  <span className="spacer" />
                  <span className="mono body-sm muted">{tasks.length}</span>
                </div>
                <div className="col" style={{ gap: 10 }}>
                  {tasks.map((task) => {
                    const overdue = isOverdue(task.due);
                    return (
                      <div
                        key={task.id}
                        className="card card-hover"
                        draggable
                        onDragStart={() => setDraggingId(task.id)}
                        onClick={() => setOpenTask(task)}
                        style={{
                          background: 'var(--bg-base)',
                          padding: 'var(--space-4)',
                          cursor: 'grab',
                        }}
                      >
                        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                          <span className={`dot dot-${PRIORITY_DOT[task.priority]}`} />
                          <span className="mono body-xs muted" style={{ letterSpacing: '0.08em' }}>
                            {task.case.toUpperCase()}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            lineHeight: 1.4,
                            marginBottom: 12,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {task.title}
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <div
                            className="avatar"
                            style={{ width: 24, height: 24, fontSize: 11 }}
                          >
                            {task.assignee}
                          </div>
                          <span className="spacer" />
                          <span
                            className="mono body-xs"
                            style={{
                              color: overdue ? 'var(--danger)' : 'var(--text-tertiary)',
                            }}
                          >
                            {task.due}
                          </span>
                          {task.comments > 0 && (
                            <span className="mono body-xs muted">
                              {task.comments} cmt
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openTask && (
        <>
          <div
            onClick={closeDrawer}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 60,
            }}
          />
          <div
            className="card"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(480px, 100vw)',
              zIndex: 61,
              padding: 'var(--space-7)',
              overflowY: 'auto',
              background: 'var(--bg-elevated)',
              borderRadius: 0,
              borderLeft: '1px solid var(--border-default)',
            }}
          >
            <div className="row" style={{ marginBottom: 16 }}>
              <span className={`dot dot-${PRIORITY_DOT[openTask.priority]}`} />
              <span className="mono body-xs muted" style={{ marginLeft: 8, letterSpacing: '0.08em' }}>
                {openTask.case.toUpperCase()}
              </span>
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
            <h2 className="heading-lg" style={{ marginBottom: 20 }}>{openTask.title}</h2>
            <div className="grid-2" style={{ gap: 16, marginBottom: 24 }}>
              <div>
                <div className="label">Assignee</div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                    {openTask.assignee}
                  </div>
                  <span className="body-sm">{openTask.assignee}</span>
                </div>
              </div>
              <div>
                <div className="label">Due</div>
                <div className="mono body-md">{openTask.due}</div>
              </div>
            </div>
            <div className="label">Description</div>
            <p className="body-sm muted" style={{ marginBottom: 24 }}>No description recorded.</p>
            <div className="label">Comments ({openTask.comments})</div>
            <div className="col" style={{ gap: 12, marginBottom: 20 }}>
              <textarea className="input" rows={3} placeholder="Add a comment…" style={{ height: 'auto' }} />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => moveOpenTask('review', { type: 'cobalt', text: 'Sent for review' })}
              >
                Request Review
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => moveOpenTask('done', { type: 'sage', text: 'Task approved' })}
              >
                Approve
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
            <div
              style={{
                marginTop: 24,
                paddingTop: 16,
                borderTop: '1px solid var(--border-default)',
              }}
            >
              {confirmingDelete ? (
                <div className="col" style={{ gap: 10 }}>
                  <p className="body-sm" style={{ color: 'var(--danger)' }}>
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
                  style={{ color: 'var(--danger)' }}
                >
                  <Icon name="close" size={14} /> Delete task
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 1023px) { .kanban { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 640px)  { .kanban { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}
