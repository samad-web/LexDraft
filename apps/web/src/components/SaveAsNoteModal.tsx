import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CaseNoteVisibility } from '@lexdraft/types';
import { useCases } from '@/hooks/useCases';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

/** The case-note body limit (POST /case-notes). */
export const MAX_NOTE_CHARS = 50_000;

/** Save each chosen case's note; one failure doesn't stop the others. Returns
 *  the titles that failed. Each case gets its OWN note (Option A). */
export async function saveNotes(
  post: (caseId: string) => Promise<unknown>,
  cases: ReadonlyArray<{ id: string; title: string }>,
): Promise<string[]> {
  const results = await Promise.allSettled(cases.map((c) => post(c.id)));
  return cases.filter((_, i) => results[i]!.status === 'rejected').map((c) => c.title);
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  /** Pre-ticked case (the draft's own). */
  defaultCaseId?: string;
}

/** Draft page "Save as case note" (save-as-case-note): the document's TEXT as a
 *  note on one or more cases, shared or private. */
export function SaveAsNoteModal({ open, onClose, title, text, defaultCaseId }: Props) {
  const cases = useCases(undefined, { enabled: open });
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaultCaseId ? [defaultCaseId] : []));
  const [visibility, setVisibility] = useState<CaseNoteVisibility>('shared');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = text.trim();
  const tooLong = body.length > MAX_NOTE_CHARS;

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLong || !body || picked.size === 0) return;
    const chosen = (cases.data ?? []).filter((c) => picked.has(c.id));
    setSaving(true);
    setError(null);
    const failed = await saveNotes(
      (caseId) => api.post('/case-notes', { caseId, title: title.slice(0, 200), body, visibility }),
      chosen,
    );
    setSaving(false);
    chosen.forEach((c) => void qc.invalidateQueries({ queryKey: ['case-notes', c.id] }));
    if (failed.length) {
      setError(`Couldn’t save the note in: ${failed.join(', ')}.${failed.length < chosen.length ? ' The other cases have it.' : ''}`);
      return;
    }
    showToast({
      type: 'sage',
      text: `Saved as a ${visibility === 'shared' ? 'shared' : 'private'} note in ${chosen.length === 1 ? chosen[0]!.title : `${chosen.length} cases`}.`,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Case notes"
      title="Save as case note"
      description="Saves this document's text as a note, a separate note in each case you pick. Notes are text only (no Word layout), and AI drafting for the case reads them, so keep notes short; full documents belong in Documents."
      onSubmit={submit}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || tooLong || !body || picked.size === 0}>
            {saving ? 'Saving…' : picked.size > 1 ? `Save in ${picked.size} cases` : 'Save note'}
          </button>
        </>
      }
    >
      {tooLong && (
        <p role="alert" style={{ margin: 0, fontWeight: 500 }}>
          This document is too long for a note ({body.length.toLocaleString('en-IN')} characters; a note holds {MAX_NOTE_CHARS.toLocaleString('en-IN')}). Keep it in Documents, or save a short summary as a note.
        </p>
      )}
      <Field label="CASES" required wide hint="Each case gets its own note">
        <div role="group" aria-label="Cases" style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 }}>
          {(cases.data ?? []).length === 0 && <span>{cases.isLoading ? 'Loading cases…' : 'No cases yet.'}</span>}
          {(cases.data ?? []).map((c) => (
            <label key={c.id} className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              <span>{c.title}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="WHO CAN SEE IT" wide>
        <div role="radiogroup" aria-label="Who can see it" className="row" style={{ gap: 16 }}>
          {([['shared', 'Shared with the team'], ['private', 'Only me']] as const).map(([v, label]) => (
            <label key={v} className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="note-visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
              {label}
            </label>
          ))}
        </div>
      </Field>
      {error && <p role="alert" style={{ margin: 0, fontWeight: 500 }}>{error}</p>}
    </Modal>
  );
}
