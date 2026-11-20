import { useState, type FormEvent } from 'react';
import { DatePicker, TimePicker } from '@lexdraft/ui';
import { toRemindAt, useCreateReminder } from '@/hooks/useReminders';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

const tomorrowIso = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Remind me on <date> at <time>" for a case (or on its own). Sent to the
 *  bell and to this user's phone/computer (build-docs/features/reminders.md). */
export function ReminderModal({
  open,
  onClose,
  caseId,
  defaultTitle = '',
}: {
  open: boolean;
  onClose: () => void;
  caseId?: string;
  defaultTitle?: string;
}) {
  const create = useCreateReminder();
  const showToast = useUIStore((s) => s.showToast);
  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(tomorrowIso());
  const [time, setTime] = useState('19:00');
  const [note, setNote] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ caseId: caseId ?? null, title: title.trim(), note: note.trim(), remindAt: toRemindAt(date, time) });
      showToast({ type: 'sage', text: `Reminder set for ${new Date(toRemindAt(date, time)).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` });
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not set the reminder';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Reminder"
      title="Set a reminder"
      description="It comes to the bell and to your phone or computer, if notifications are on."
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Saving…' : 'Set reminder'}
          </button>
        </>
      }
    >
      <Field label="REMIND ME TO" required wide>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
          placeholder="e.g. Prepare cross-examination of PW-1" required autoFocus />
      </Field>
      <div className="form-row">
        <Field label="DATE" required>
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="TIME" required>
          <TimePicker value={time} onChange={setTime} />
        </Field>
      </div>
      <Field label="NOTE" hint="Optional" wide>
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
    </Modal>
  );
}
