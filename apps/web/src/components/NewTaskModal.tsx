import { useState, type FormEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { TaskColumn, TaskPriority } from '@lexdraft/types';
import { useCreateTask } from '@/hooks/useTasks';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCase?: string;
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

export function NewTaskModal({ open, onClose, defaultCase }: Props) {
  const create = useCreateTask();
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState('');
  const [caseLabel, setCaseLabel] = useState(defaultCase ?? '');
  const [due, setDue] = useState<string>(inDays(7));
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignee, setAssignee] = useState('');
  const [column, setColumn] = useState<TaskColumn>('pending');

  const reset = () => {
    setTitle('');
    setCaseLabel(defaultCase ?? '');
    setDue(inDays(7));
    setPriority('medium');
    setAssignee('');
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
        assignee: assignee.trim() || 'ME',
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
      <Field label="TITLE *" wide>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Prepare written statement draft"
          required
          autoFocus
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="MATTER *">
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="Case label"
            required
          />
        </Field>
        <Field label="DUE *">
          <DatePicker value={due} onChange={setDue} />
        </Field>
        <Field label="PRIORITY *">
          <Select
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority)}
            options={PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Field>
        <Field label="COLUMN *">
          <Select
            value={column}
            onChange={(v) => setColumn(v as TaskColumn)}
            options={COLUMNS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
          />
        </Field>
        <Field label="ASSIGNEE INITIALS" wide>
          <input
            className="input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="e.g. RM"
          />
        </Field>
      </div>
    </Modal>
  );
}
