import { useState } from 'react';
import { api } from '@/lib/api';
import type { ReviewNote } from '@/lib/review-ink';
import { reviewErrorText } from '@/lib/review-copy';
import { useUIStore } from '@/store/ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** team-docs: tick a margin note Done (who, when) and reply to it. Anyone in the
 *  firm who can open the review can do this; the marks stay the marker's own. */
export function NoteWork({ reviewId, note, onChanged }: {
  reviewId: string;
  note: ReviewNote;
  onChanged: (notes: ReviewNote[]) => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (body: { done?: boolean; reply?: string }) => {
    setBusy(true);
    try {
      const r = await api.post<{ notes: ReviewNote[] }>(`/reviews/${reviewId}/notes/${note.id}`, body);
      onChanged(r.notes);
      if (body.reply) setReply('');
    } catch (e) {
      showToast({ type: 'amber', text: reviewErrorText((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 8 }}>
      <label className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={!!note.done} disabled={busy} onChange={(e) => void send({ done: e.target.checked })} />
        {note.done ? <span>Done by <strong>{note.done.name}</strong> · {when(note.done.at)}</span> : <span>Mark as done</span>}
      </label>
      {(note.replies ?? []).map((r, i) => (
        <p key={i} style={{ margin: '6px 0 0', fontSize: 13 }}>
          <strong>{r.name}</strong> <span className="muted">· {when(r.at)}</span><br />{r.text}
        </p>
      ))}
      <form
        className="row"
        style={{ gap: 6, marginTop: 6 }}
        onSubmit={(e) => { e.preventDefault(); if (reply.trim()) void send({ reply }); }}
      >
        <input className="input" value={reply} maxLength={500} placeholder="Reply…" aria-label="Reply to this note"
          onChange={(e) => setReply(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" className="btn btn-sm" disabled={busy || !reply.trim()}>Reply</button>
      </form>
    </div>
  );
}
