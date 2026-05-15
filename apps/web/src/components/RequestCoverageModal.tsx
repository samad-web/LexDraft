/**
 * Request-coverage modal - invoked from the Diary view (and any other
 * surface that lists a hearing). When pre-filled from a hearing row we lock
 * the matter/court/date/time as read-only context and the user only fills
 * the brief packet (URL + notes).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useCreateCoverage } from '@/hooks/useCoverage';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Defaults {
  hearingId?: string;
  caseLabel?: string;
  court?: string;
  hearingDate?: string;
  hearingTime?: string;
  purpose?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaults?: Defaults;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RequestCoverageModal({ open, onClose, defaults }: Props) {
  const create = useCreateCoverage();
  const showToast = useUIStore((s) => s.showToast);

  const [caseLabel, setCaseLabel] = useState(defaults?.caseLabel ?? '');
  const [court, setCourt] = useState(defaults?.court ?? '');
  const [hearingDate, setHearingDate] = useState(defaults?.hearingDate ?? todayIso());
  const [hearingTime, setHearingTime] = useState(defaults?.hearingTime ?? '10:30');
  const [purpose, setPurpose] = useState(defaults?.purpose ?? '');
  const [briefUrl, setBriefUrl] = useState('');
  const [briefNotes, setBriefNotes] = useState('');

  // Re-prefill when defaults change (e.g. clicking a different hearing row
  // without closing the parent component in between).
  useEffect(() => {
    if (!open) return;
    setCaseLabel(defaults?.caseLabel ?? '');
    setCourt(defaults?.court ?? '');
    setHearingDate(defaults?.hearingDate ?? todayIso());
    setHearingTime(defaults?.hearingTime ?? '10:30');
    setPurpose(defaults?.purpose ?? '');
    setBriefUrl('');
    setBriefNotes('');
  }, [open, defaults?.caseLabel, defaults?.court, defaults?.hearingDate, defaults?.hearingTime, defaults?.purpose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        hearingId: defaults?.hearingId,
        caseLabel: caseLabel.trim() || undefined,
        court: court.trim() || undefined,
        hearingDate: hearingDate || undefined,
        hearingTime: hearingTime || undefined,
        purpose: purpose.trim() || undefined,
        briefUrl: briefUrl.trim() || undefined,
        briefNotes: briefNotes.trim() || undefined,
      });
      showToast({ type: 'sage', text: 'Coverage request posted to the board' });
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to post coverage request';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Coverage board"
      title="Request hearing coverage"
      description="Post this matter for a colleague to pick up. Add a brief packet so they can step in cold."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Posting…' : 'Post to board'}
          </button>
        </>
      }
    >
      <Field label="MATTER *" wide>
        <input
          className="input"
          value={caseLabel}
          onChange={(e) => setCaseLabel(e.target.value)}
          placeholder="e.g. Mehta v. Skyline"
          required
          autoFocus={!defaults?.caseLabel}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="DATE *">
          <input
            type="date"
            className="input"
            value={hearingDate}
            onChange={(e) => setHearingDate(e.target.value)}
            required
          />
        </Field>
        <Field label="TIME *">
          <input
            className="input"
            value={hearingTime}
            onChange={(e) => setHearingTime(e.target.value)}
            placeholder="10:30"
            required
          />
        </Field>
        <Field label="COURT *" wide>
          <input
            className="input"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            placeholder="e.g. Madras High Court"
            required
          />
        </Field>
        <Field label="PURPOSE *" wide>
          <input
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Arguments on interim relief"
            required
          />
        </Field>
        <Field label="BRIEF URL" wide>
          <input
            className="input"
            value={briefUrl}
            onChange={(e) => setBriefUrl(e.target.value)}
            placeholder="Optional - link to the brief packet"
          />
        </Field>
        <Field label="NOTES FOR COVERING COUNSEL" wide>
          <textarea
            className="input"
            value={briefNotes}
            onChange={(e) => setBriefNotes(e.target.value)}
            rows={4}
            style={{ height: 'auto', resize: 'vertical' }}
            placeholder="Key facts, what to argue, opposing counsel quirks…"
          />
        </Field>
      </div>
    </Modal>
  );
}
