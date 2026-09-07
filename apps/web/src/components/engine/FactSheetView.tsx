// =============================================================================
// FactSheetView — the always-visible, editable fact sheet (plan §10, §11).
//
// The conversation is the INPUT method, not the only view of the data. This
// panel shows every field the engine tracks, grouped by section, with:
//   * the current value (editable in place),
//   * a DERIVED marker when the model inferred the value rather than the advocate
//     stating it (§11) — the derivation shown on the marker's title,
//   * an "outstanding" marker for fields the engine still needs.
//
// Editing a field here is a first-class input: it commits through the SAME
// merge -> revise -> draft path as talking (onEdit -> POST /intake/edit). This
// is where an extraction error gets caught before it reaches the draft.
// =============================================================================

import { useEffect, useState } from 'react';
import type { FactSheetSection, FactSheetField } from '@lexdraft/types';

interface Props {
  sections: FactSheetSection[];
  /** Fields the ask-counter guard downgraded to direct typed entry (§5.2). */
  directEntryFields: string[];
  /** Commit edited fields (field key -> new value). Empty string clears a field. */
  onEdit: (edits: Record<string, string>) => void;
  busy?: boolean;
}

export function FactSheetView({ sections, directEntryFields, onEdit, busy }: Props) {
  const directSet = new Set(directEntryFields);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // When the server state changes (a turn completed), drop local edit drafts that
  // now match the committed value so the inputs reflect the source of truth.
  useEffect(() => {
    setDrafts((d) => {
      if (Object.keys(d).length === 0) return d;
      const next: Record<string, string> = {};
      for (const sec of sections) {
        for (const f of sec.fields) {
          if (f.key in d && d[f.key] !== (f.value ?? '')) next[f.key] = d[f.key]!;
        }
      }
      return next;
    });
  }, [sections]);

  const valueOf = (f: FactSheetField) => drafts[f.key] ?? f.value ?? '';
  const dirty = (f: FactSheetField) => f.key in drafts && drafts[f.key] !== (f.value ?? '');

  const commit = (f: FactSheetField) => {
    if (!dirty(f)) return;
    onEdit({ [f.key]: drafts[f.key]! });
  };

  const outstandingCount = sections.reduce(
    (n, s) => n + s.fields.filter((f) => f.outstanding).length,
    0,
  );

  return (
    <div className="intake-factsheet" aria-label="Fact sheet">
      <div className="intake-factsheet__head">
        <h3 className="intake-factsheet__title">Fact sheet</h3>
        <span className="intake-factsheet__count">
          {outstandingCount === 0 ? 'complete' : `${outstandingCount} still needed`}
        </span>
      </div>

      {sections.map((sec) => (
        <fieldset key={sec.title} className="intake-factsheet__section" disabled={busy}>
          <legend className="intake-factsheet__legend">{sec.title}</legend>
          {sec.fields.map((f) => {
            const derived = f.meta?.confidence === 'inferred';
            const direct = directSet.has(f.key);
            return (
              <div
                key={f.key}
                className={
                  'intake-field' +
                  (f.outstanding ? ' intake-field--outstanding' : '') +
                  (direct ? ' intake-field--direct' : '')
                }
              >
                <label className="intake-field__label" htmlFor={`fs-${f.key}`}>
                  {f.label}
                  {f.required && <span className="intake-field__req" aria-hidden> *</span>}
                  {derived && (
                    <span
                      className="intake-field__derived"
                      title={
                        f.meta?.derivation
                          ? `Derived: ${f.meta.derivation}`
                          : 'The model derived this value rather than you stating it.'
                      }
                    >
                      derived
                    </span>
                  )}
                  {direct && (
                    <span className="intake-field__directtag" title="Easier to type in directly.">
                      type it in
                    </span>
                  )}
                </label>

                {renderInput(f, `fs-${f.key}`, valueOf(f), (v) =>
                  setDrafts((d) => ({ ...d, [f.key]: v })), () => commit(f))}

                {dirty(f) && (
                  <button
                    type="button"
                    className="intake-field__save"
                    onClick={() => commit(f)}
                    disabled={busy}
                  >
                    Save
                  </button>
                )}

                {f.outstanding && !dirty(f) && (
                  <span className="intake-field__hint">
                    {f.issueCode === 'required' || !f.issueCode
                      ? 'still needed'
                      : f.issueCode === 'enum'
                        ? 'pick one of the options'
                        : "didn't come through in a usable form"}
                  </span>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function renderInput(
  f: FactSheetField,
  id: string,
  value: string,
  onChange: (v: string) => void,
  onCommit: () => void,
) {
  const common = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
    onBlur: onCommit,
    className: 'intake-field__input',
  };
  if (f.type === 'select' && f.options) {
    return (
      <select {...common}>
        <option value="">—</option>
        {f.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (f.type === 'textarea') {
    return <textarea {...common} rows={3} />;
  }
  const htmlType = f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'currency' ? 'text' : 'text';
  return <input type={htmlType} {...common} />;
}
