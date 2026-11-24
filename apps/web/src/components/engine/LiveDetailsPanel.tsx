import type { DraftLang } from '../../lib/draftLanguages';
// =============================================================================
// LiveDetailsPanel — the "Missing details" card beside a drafted document.
//
// Lists the details the document still needs (required ones first), each with
// an input. Typing only fills the form: the document is re-drafted ONCE, when
// the advocate clicks "Update document" (owner 2026-11-24 — no re-draft on
// every keystroke). Anything left blank stays a [placeholder] instead of
// blocking. The action bar stays pinned so it's visible however long the list.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import type { FactSheetField, IntakeState } from '@lexdraft/types';
import { useIntakeEdit } from '@/hooks/useIntake';
import { clearEdits, draftKey, getEdits, setEdit, updateRequest, type DetailEdits } from './detail-edits';

interface Props {
  /** The intake state behind the current draft (matterId, docLabel, fact sheet). */
  state: IntakeState;
  /** Called with the re-drafted state after "Update document". */
  onUpdated: (state: IntakeState) => void;
  /** The advocate has hand-edited the document text; an update would replace it. */
  locked: boolean;
  /** Discard the hand edits so updates can resume. */
  onUnlock: () => void;
  language?: DraftLang;
}

/** A value the engine filled in for a gap ("[name of the party to be provided]"). */
const PLACEHOLDER = /\[[^\]]{0,80}?\bto be (?:drafted|provided|filled|completed|supplied)\b[^\]]{0,80}?\]/i;

function isMissing(f: FactSheetField): boolean {
  const v = (f.value ?? '').trim();
  return !v || PLACEHOLDER.test(v);
}

/** How many details a drafted document still needs (required and optional). */
export function missingDetailCount(state: IntakeState): number {
  return state.factSheet.flatMap((s) => s.fields).filter(isMissing).length;
}

export function LiveDetailsPanel({ state, onUpdated, locked, onUnlock, language }: Props) {
  const edit = useIntakeEdit();
  const fields = useMemo(() => state.factSheet.flatMap((s) => s.fields), [state.factSheet]);
  const key = draftKey(state.matterId, state.docLabel);
  // What the advocate has typed and not yet applied (kept across popup close/open).
  const [typed, setTyped] = useState<DetailEdits>(() => getEdits(key));
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // A new draft (different matter or format) starts from its own typed details.
  useEffect(() => {
    setTyped(getEdits(key));
    setNote(null);
  }, [key]);

  const valueOf = (f: FactSheetField) =>
    typed[f.key] ?? (isMissing(f) ? '' : (f.value ?? ''));

  // Typing only fills the form; nothing is sent and the document doesn't change.
  const change = (field: string, value: string) => {
    setTyped(setEdit(key, field, value));
    setNote(null);
  };

  // "Update document": the advocate's approval. One re-draft with every typed detail.
  const apply = async () => {
    const req = updateRequest(state.matterId, state.docLabel, typed, language);
    if (!req) return;
    try {
      const next = await edit.mutateAsync(req);
      if (next.status === 'refused' && next.refusal) {
        setNote(`Not updated: ${next.refusal.reason}`);
        return;
      }
      if (next.status !== 'generated' || !next.draft) {
        setNote('Saved. The document will update once the remaining required details are in.');
        return;
      }
      clearEdits(key);
      setTyped({});
      setNote('Document updated.');
      onUpdated(next);
    } catch {
      setNote('Could not update the document. Check your connection and try again.');
    }
  };

  const missingRequired = fields.filter((f) => f.required && isMissing(f));
  const missingOptional = fields.filter((f) => !f.required && isMissing(f));
  const filled = fields.filter((f) => !isMissing(f));
  const shown = showAll ? [...missingRequired, ...missingOptional, ...filled] : [...missingRequired, ...missingOptional];
  const missing = [...missingRequired, ...missingOptional];
  const nowFilled = missing.filter((f) => (typed[f.key] ?? '').trim()).length;
  const stillBlank = missing.length - nowFilled;
  const hasTyped = Object.keys(typed).length > 0;

  if (fields.length === 0) return null;

  return (
    <section className="dc-card">
      <div className="dw-card-head">
        <div className="dc-eyebrow">Missing details</div>
        <span className="dw-count">{missing.length}</span>
      </div>
      <p className="dc-card-text" style={{ marginTop: 0 }}>
        {missing.length === 0
          ? 'Every detail is filled. Edit any of them, then click Update document.'
          : 'Fill these in, then click Update document. The document doesn’t change until you do. Anything left blank stays a [placeholder].'}
      </p>

      {locked && (
        <div className="body-xs" style={{ marginBottom: 8 }}>
          You’ve edited the document text by hand, so updates are paused (they would replace your edits).{' '}
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

      {/* Pinned to the bottom of the popup / rail so it's in view however long the list. */}
      <div className="ldp-actions">
        {missing.length > 0 && (
          <div className="body-xs" aria-live="polite">
            {nowFilled} of {missing.length} filled
            {hasTyped && stillBlank > 0 ? ` · ${stillBlank} will stay as [placeholders]` : ''}
          </div>
        )}
        <button type="button" className="btn btn-primary btn-sm"
          disabled={locked || edit.isPending || !hasTyped} onClick={() => { void apply(); }}>
          {edit.isPending ? 'Updating…' : 'Update document'}
        </button>
        <div className="body-xs muted" style={{ minHeight: 16 }} aria-live="polite">
          {edit.isPending ? 'Updating the document…' : note}
        </div>
      </div>
    </section>
  );
}

/** "judicial_separation" -> "Judicial separation" for display; the value sent stays raw. */
function optionLabel(o: string): string {
  const t = o.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function FieldInput({ field, value, disabled, onChange }: {
  field: FactSheetField; value: string; disabled: boolean; onChange: (v: string) => void;
}) {
  if (field.type === 'select' && field.options?.length) {
    return (
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
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
