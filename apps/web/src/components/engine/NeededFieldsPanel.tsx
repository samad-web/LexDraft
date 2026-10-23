// =============================================================================
// NeededFieldsPanel — "I still need X" made actionable.
//
// When "Draft now" can't fill a gap itself (a fixed legal choice such as a
// divorce ground, or a fact a hard-stop names), the drafting card used to say
// "add them above and Submit again" with nowhere to add them. This shows exactly
// those fields — dropdowns for fixed choices — and drafts as soon as they're
// given (intake edit with draftNow: save, then draft with [placeholders]).
// =============================================================================

import { useMemo, useState } from 'react';
import type { FactSheetField, IntakeState } from '@lexdraft/types';
import { useIntakeEdit } from '@/hooks/useIntake';
import { FieldInput } from './LiveDetailsPanel';

interface Props {
  /** The not-yet-drafted state (gathering, or refused naming fields). */
  state: IntakeState;
  language?: 'EN' | 'HI' | 'TA';
  /** The document drafted. */
  onDrafted: (state: IntakeState) => void;
  /** Still can't draft: the next state + what to tell the advocate. */
  onStill: (state: IntakeState, message: string) => void;
}

/** The fields the engine is waiting on: outstanding ones, plus any a refusal names. */
export function neededFields(state: IntakeState): FactSheetField[] {
  const implicated = new Set(
    (state.refusal?.fields_implicated ?? []).map((f) => f.replace(/\[\d+\].*$/, '')),
  );
  return state.factSheet
    .flatMap((s) => s.fields)
    .filter((f) => f.outstanding || implicated.has(f.key));
}

export function NeededFieldsPanel({ state, language, onDrafted, onStill }: Props) {
  const edit = useIntakeEdit();
  const fields = useMemo(() => neededFields(state), [state]);
  const [values, setValues] = useState<Record<string, string>>({});

  if (fields.length === 0) return null;
  const filled = Object.entries(values).filter(([, v]) => v.trim());

  const draft = async () => {
    try {
      const next = await edit.mutateAsync({
        matterId: state.matterId,
        docLabel: state.docLabel,
        edits: Object.fromEntries(filled),
        draftNow: true,
        ...(language && language !== 'EN' ? { language } : {}),
      });
      if (next.status === 'generated' && next.draft) {
        onDrafted(next);
        return;
      }
      if (next.status === 'refused' && next.refusal) {
        onStill(next, `This can’t be drafted yet: ${next.refusal.reason}.`);
        return;
      }
      const still = neededFields(next).map((f) => f.label);
      onStill(next, still.length ? `Still needed: ${still.join(', ')}.` : 'A little more is needed to draft this.');
    } catch {
      onStill(state, 'Could not draft. Check your connection and try again.');
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginTop: 10 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
        NEEDED TO DRAFT
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}
      >
        {fields.map((f) => (
          <label key={f.key} className="col" style={{ gap: 3 }}>
            <span className="body-xs">{f.label}{f.required ? ' *' : ''}</span>
            <FieldInput
              field={f}
              value={values[f.key] ?? ''}
              disabled={edit.isPending}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            />
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={edit.isPending || filled.length === 0}
          onClick={() => { void draft(); }}
        >
          {edit.isPending ? 'Drafting…' : 'Draft with these'}
        </button>
        <span className="body-xs muted">Anything else missing is left as a [placeholder] you can fill later.</span>
      </div>
    </div>
  );
}
