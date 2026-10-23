// =============================================================================
// LiveDetailsPanel — the "Missing details" card beside a drafted document.
//
// Lists the details the document still needs (required ones first), each with
// an input. As the advocate types, the edits are saved to the matter's fact
// sheet and the document is RE-DRAFTED straight away (POST /engine/intake/edit
// with draftNow), so the preview updates within a second or two — no "Submit
// again", and anything still missing stays a [placeholder] instead of blocking.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FactSheetField, IntakeState } from '@lexdraft/types';
import { useIntakeEdit } from '@/hooks/useIntake';

interface Props {
  /** The intake state behind the current draft (matterId, docLabel, fact sheet). */
  state: IntakeState;
  /** Called with the re-drafted state after each saved edit. */
  onUpdated: (state: IntakeState) => void;
  /** The advocate has hand-edited the document text; live updates would replace it. */
  locked: boolean;
  /** Discard the hand edits so live updates can resume. */
  onUnlock: () => void;
  language?: 'EN' | 'HI' | 'TA';
}

const DEBOUNCE_MS = 900;
/** A value the engine filled in for a gap ("[name of the party to be provided]"). */
const PLACEHOLDER = /\[[^\]]{0,80}?\bto be (?:drafted|provided|filled|completed|supplied)\b[^\]]{0,80}?\]/i;

function isMissing(f: FactSheetField): boolean {
  const v = (f.value ?? '').trim();
  return !v || PLACEHOLDER.test(v);
}

export function LiveDetailsPanel({ state, onUpdated, locked, onUnlock, language }: Props) {
  const edit = useIntakeEdit();
  const fields = useMemo(() => state.factSheet.flatMap((s) => s.fields), [state.factSheet]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const pending = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new draft (different matter or format) starts from its own fact sheet.
  useEffect(() => {
    setValues({});
    setNote(null);
    pending.current = {};
  }, [state.matterId, state.docLabel]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const valueOf = (f: FactSheetField) =>
    values[f.key] ?? (isMissing(f) ? '' : (f.value ?? ''));

  const flush = async () => {
    const edits = pending.current;
    pending.current = {};
    if (!Object.keys(edits).length) return;
    try {
      const next = await edit.mutateAsync({
        matterId: state.matterId,
        docLabel: state.docLabel,
        edits,
        draftNow: true,
        ...(language && language !== 'EN' ? { language } : {}),
      });
      if (next.status === 'refused' && next.refusal) {
        setNote(`Not updated: ${next.refusal.reason}`);
        return;
      }
      if (next.status !== 'generated' || !next.draft) {
        setNote('Saved. The document will update once the remaining required details are in.');
        return;
      }
      setNote(null);
      onUpdated(next);
    } catch {
      setNote('Could not update the document. Check your connection and try again.');
    }
  };

  const change = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    pending.current[key] = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  };

  const missingRequired = fields.filter((f) => f.required && isMissing(f));
  const missingOptional = fields.filter((f) => !f.required && isMissing(f));
  const filled = fields.filter((f) => !isMissing(f));
  const shown = showAll ? [...missingRequired, ...missingOptional, ...filled] : [...missingRequired, ...missingOptional];

  if (fields.length === 0) return null;

  return (
    <section className="dc-card">
      <div className="dw-card-head">
        <div className="dc-eyebrow">Missing details</div>
        <span className="dw-count">{missingRequired.length + missingOptional.length}</span>
      </div>
      <p className="dc-card-text" style={{ marginTop: 0 }}>
        {missingRequired.length + missingOptional.length === 0
          ? 'Every detail is filled. Edit any of them and the document updates.'
          : 'Fill these in and the document updates as you type. Anything left blank stays a [placeholder].'}
      </p>

      {locked && (
        <div className="body-xs" style={{ marginBottom: 8 }}>
          You’ve edited the document text by hand, so live updates are paused (they would replace your edits).{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onUnlock}>Discard my text edits</button>
        </div>
      )}

      <div className="col" style={{ gap: 8 }}>
        {shown.map((f) => (
          <label key={f.key} className="col" style={{ gap: 3 }}>
            <span className="body-xs">
              {f.label}{f.required ? ' *' : ''}
            </span>
            <FieldInput field={f} value={valueOf(f)} disabled={locked} onChange={(v) => change(f.key, v)} />
          </label>
        ))}
      </div>

      {(filled.length > 0 || (!showAll && shown.length === 0)) && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show only missing details' : `Show all details (${fields.length})`}
        </button>
      )}

      <div className="body-xs muted" style={{ marginTop: 6, minHeight: 16 }} aria-live="polite">
        {edit.isPending ? 'Updating the document…' : note}
      </div>
    </section>
  );
}

function FieldInput({ field, value, disabled, onChange }: {
  field: FactSheetField; value: string; disabled: boolean; onChange: (v: string) => void;
}) {
  if (field.type === 'select' && field.options?.length) {
    return (
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea className="input" rows={3} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} style={{ resize: 'vertical' }} />
    );
  }
  const type = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
  return (
    <input className="input" type={type} value={value} disabled={disabled}
      inputMode={field.type === 'currency' ? 'decimal' : undefined}
      onChange={(e) => onChange(e.target.value)} />
  );
}
