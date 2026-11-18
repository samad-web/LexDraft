import { useEffect, useState, type FormEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { TaskColumn, TaskPriority } from '@lexdraft/types';
import { useCreateTask } from '@/hooks/useTasks';
import { useCurrentUserId, useTeammates } from '@/hooks/useAssignments';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCase?: string;
  /** Lock the MATTER field to `defaultCase` (read-only) when the modal is
   *  opened from a known case record - prevents the user from hand-editing
   *  the free-text label into drift from the case's actual title, which
   *  would silently remove the task from that case's Pendings card (tasks
   *  link to cases by title-text match, not a foreign key). */
  lockCase?: boolean;
  /** Pre-pick the member the task is for (Team page → Assign task). */
  assigneeId?: string;
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> = [
  { value: 'very_high', label: 'Very high' },
  { value: 'high',      label: 'High' },
  { value: 'medium',    label: 'Medium' },
  { value: 'low',       label: 'Low' },
];
const COLUMNS: TaskColumn[] = ['pending', 'progress', 'review', 'done'];

function inDays(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

export function NewTaskModal({ open, onClose, defaultCase, lockCase, assigneeId }: Props) {
  const create = useCreateTask();
  // team-work: pick a member, not typed initials (owner, 2026-11-18).
  const team = useTeammates();
  const me = useCurrentUserId();
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState('');
  const [caseLabel, setCaseLabel] = useState(defaultCase ?? '');
  const [due, setDue] = useState<string>(inDays(7));
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignee, setAssignee] = useState(assigneeId ?? '');
  useEffect(() => { if (open) setAssignee(assigneeId ?? me ?? ''); }, [open, assigneeId, me]);
  const members = team.data ?? [];
  const [column, setColumn] = useState<TaskColumn>('pending');

  const reset = () => {
    setTitle('');
    setCaseLabel(defaultCase ?? '');
    setDue(inDays(7));
    setPriority('medium');
    setAssignee(assigneeId ?? me ?? '');
    setColumn('pending');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        title: title.trim(),
        case: caseLabel.trim(),
        due,
        priority,
        assignee: 'ME', // the server sets the member's initials
        ...(assignee ? { assigneeUserId: assignee } : {}),
        comments: 0,
        column,
      });
      showToast({ type: 'sage', text: `Task added to ${column}` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add task';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New task"
      title="Add a task"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add task'}
          </button>
        </>
      }
    >
      <Field label="TITLE" required wide>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Prepare written statement draft"
          required
          autoFocus
        />
      </Field>
      <div className="form-row">
        <Field label="MATTER" required>
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="Case label"
            required
            readOnly={lockCase}
            title={lockCase ? 'Locked to this matter' : undefined}
            style={lockCase ? { cursor: 'not-allowed', color: 'var(--text-tertiary)' } : undefined}
          />
        </Field>
        <Field label="DUE" required>
          <DatePicker value={due} onChange={setDue} />
        </Field>
        <Field label="PRIORITY" required>
          <Select
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority)}
            options={PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Field>
        <Field label="COLUMN" required>
          <Select
            value={column}
            onChange={(v) => setColumn(v as TaskColumn)}
            options={COLUMNS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
          />
        </Field>
        <Field label="ASSIGN TO" wide>
          <Select
            value={assignee}
            onChange={setAssignee}
            options={members.length
              ? members.map((m) => ({ value: m.id, label: m.id === me ? `${m.name} (me)` : m.name }))
              : [{ value: me ?? '', label: 'Me' }]}
          />
        </Field>
      </div>
    </Modal>
  );
}
