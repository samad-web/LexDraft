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
  const dictation = useDictation();

  const missing: DocField[] = [];
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.required && !(values[f.key] ?? '').toString().trim()) missing.push(f);
    }
  }
  if (missing.length === 0) return null;

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
        <div className="heading-md">Finish the document</div>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="badge badge-amber">{missing.length} to add</span>
      </div>
      <p className="body-sm muted" style={{ margin: 0 }}>
        Your brief didn’t cover these required details. Add them, then regenerate to complete the draft.
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
