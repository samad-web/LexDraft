import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { Field } from './DraftField';
import { useDictation } from '@/hooks/useDictation';
import type { DocField, DocSchema } from '@/lib/doc-schemas';

interface Props {
  schema: DocSchema;
  values: Record<string, string>;
  setField: (key: string, val: string) => void;
  onRegenerate: () => void;
  /** True while a generation is streaming. */
  busy: boolean;
}

/**
 * After a generation, surfaces the required fields the brief didn't cover so the
 * advocate can complete them (type or dictate) and regenerate to finish. Renders
 * nothing when every required field is filled.
 */
export function DraftMissingFields({ schema, values, setField, onRegenerate, busy }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // COLLAPSED BY DEFAULT. The document has already been drafted with these gaps shown
  // inline as [placeholders] — the advocate can fill them right in the editor. So this
  // panel is an OPTIONAL shortcut (type/dictate the values here + regenerate), not a
  // blocking form. It opens only when the advocate chooses to.
  const [open, setOpen] = useState(false);
  const dictation = useDictation();

  const missing: DocField[] = [];
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.required && !(values[f.key] ?? '').toString().trim()) missing.push(f);
    }
  }
  if (missing.length === 0) return null;

  // Collapsed: a single quiet line. The draft is complete with placeholders; this is
  // just an offer to fill them faster.
  if (!open) {
    return (
      <button
        type="button"
        className="card"
        onClick={() => setOpen(true)}
        style={{
          padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', textAlign: 'left', cursor: 'pointer',
          borderColor: 'var(--border-default)', background: 'var(--bg-surface-2)',
        }}
      >
        <Icon name="flag" size={15} />
        <span className="body-sm">
          Draft ready. <strong>{missing.length}</strong> detail{missing.length === 1 ? '' : 's'} left as
          {' '}<code>[placeholders]</code> — edit them in the document, or click to fill here.
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <Icon name="chevronD" size={16} />
      </button>
    );
  }

  const micFor = (key: string) => {
    if (dictation.listening && activeKey === key) {
      dictation.stop();
      return;
    }
    setActiveKey(key);
    const current = values[key] ?? '';
    dictation.start((t) => setField(key, current ? `${current} ${t}` : t));
  };

  return (
    <div
      className="card"
      style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'var(--amber, var(--border-default))' }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="flag" size={16} />
        <div className="heading-md">Fill the remaining details (optional)</div>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="badge badge-amber">{missing.length}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
          title="Collapse — the draft is ready; fill these in the document instead"
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <p className="body-sm muted" style={{ margin: 0 }}>
        The draft is ready with these shown as <code>[placeholders]</code>. Fill them here and
        regenerate, or just edit them directly in the document.
      </p>

      <div className="col" style={{ gap: 12 }}>
        {missing.map((f) => (
          <div key={f.key} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field field={f} value={values[f.key] ?? ''} onChange={(v) => setField(f.key, v)} />
            </div>
            {dictation.supported && (
              <button
                type="button"
                className={`btn btn-ghost btn-sm ${dictation.listening && activeKey === f.key ? 'active' : ''}`}
                onClick={() => micFor(f.key)}
                title={dictation.listening && activeKey === f.key ? 'Stop dictation' : `Dictate ${f.label}`}
                aria-pressed={dictation.listening && activeKey === f.key}
              >
                <Icon name={dictation.listening && activeKey === f.key ? 'micOff' : 'mic'} size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={onRegenerate} disabled={busy}>
          <Icon name="draft" size={14} /> {busy ? 'Regenerating…' : 'Regenerate to finish'}
        </button>
      </div>
    </div>
  );
}
