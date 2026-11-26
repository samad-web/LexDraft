import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useTeammates } from '@/hooks/useAssignments';
import { useCurrentUserId } from '@/hooks/useAssignments';
import { reviewErrorText } from '@/lib/review-copy';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from '../Modal';

/** team-docs: send a marked copy to teammates to work on: each gets a task on
 *  their board and a notification that opens this review. */
export function SendToTeammate({ open, onClose, reviewId }: { open: boolean; onClose: () => void; reviewId: string }) {
  const team = useTeammates();
  const me = useCurrentUserId();
  const showToast = useUIStore((s) => s.showToast);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const people = (team.data ?? []).filter((t) => t.id !== me);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked.size) return;
    setBusy(true);
    try {
      const r = await api.post<{ sent: number }>(`/reviews/${reviewId}/send`, {
        userIds: [...picked], ...(message.trim() ? { message: message.trim() } : {}), ...(due ? { due } : {}),
      });
      showToast({ type: 'sage', text: `Sent to ${r.sent} teammate${r.sent === 1 ? '' : 's'}. It's on their task board, and they've been notified.` });
      setPicked(new Set());
      setMessage('');
      onClose();
    } catch (err) {
      showToast({ type: 'amber', text: reviewErrorText((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Team"
      title="Send to teammate"
      description="They get a task and a notification. They open this marked copy, tick each note Done as they fix it, and you're told when all are done."
      onSubmit={submit}
      width={520}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !picked.size}>{busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <Field label="TEAMMATES" required wide>
        <div role="group" aria-label="Teammates" style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {people.length === 0 && <span>{team.isLoading ? 'Loading…' : 'No teammates yet. Add members from Team.'}</span>}
          {people.map((t) => (
            <label key={t.id} className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(t.id)}
                onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
              <span>{t.name} <span className="muted">· {t.role}</span></span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="MESSAGE" wide>
        <input className="input" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please fix these before Friday's hearing" />
      </Field>
      <Field label="DUE DATE">
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
    </Modal>
  );
}
