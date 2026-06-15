import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useExtractDraftFields, type LlmProvider } from '@/hooks/useDrafting';
import { useDictation } from '@/hooks/useDictation';
import { useUIStore } from '@/store/ui';
import { briefGuideFor, fieldSpecFor, missingRequiredLabels } from '@/lib/draft-brief';
import type { DocSchema } from '@/lib/doc-schemas';

interface Props {
  docType: string;
  schema: DocSchema;
  provider: LlmProvider;
  /** Replace the current doc's values with the extracted set. */
  onExtracted: (values: Record<string, string>) => void;
  /** Generate immediately, bypassing the required-field block. */
  onGenerateNow: () => void;
  /** Switch to the field form to complete / review. */
  onSwitchToForm: () => void;
}

interface ExtractSummary {
  captured: number;
  total: number;
  missing: string[];
  modelUsed: string;
}

export function DraftPromptPanel({ docType, schema, provider, onExtracted, onGenerateNow, onSwitchToForm }: Props) {
  const [brief, setBrief] = useState('');
  const [summary, setSummary] = useState<ExtractSummary | null>(null);
  const extract = useExtractDraftFields();
  const dictation = useDictation();
  const showToast = useUIStore((s) => s.showToast);

  const guide = briefGuideFor(schema);

  const dictate = () => dictation.toggle((t) => setBrief((prev) => (prev ? `${prev} ${t}` : t)));

  const runExtract = async () => {
    const b = brief.trim();
    if (!b || extract.isPending) return;
    const spec = fieldSpecFor(schema);
    try {
      const res = await extract.mutateAsync({ docType, brief: b, fields: spec, provider });
      onExtracted(res.values);
      setSummary({
        captured: Object.keys(res.values).length,
        total: spec.length,
        missing: missingRequiredLabels(schema, res.values),
        modelUsed: res.modelUsed,
      });
    } catch (err) {
      // 402/429 quota are handled globally by the axios interceptor; surface
      // anything else as a toast.
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error)?.message ??
        'Could not read the brief. Try again.';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const extractedNothing = summary !== null && summary.captured === 0;

  return (
    <div className="col" style={{ padding: '16px 18px', gap: 16 }}>
      <div className="col" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="chat" size={16} />
          <div className="heading-md">Dictate the brief</div>
        </div>
        <p className="body-sm muted" style={{ margin: 0 }}>
          Describe the matter in plain language — we’ll fill the {docType} fields for you and flag anything still
          needed. You can edit everything before generating.
        </p>
      </div>

      {/* Auto-derived structure guidance (the "sample prompt"). */}
      <div
        className="col"
        style={{ gap: 8, padding: 'var(--space-4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface-2)' }}
      >
        <div className="mono body-xs muted">COVER THESE DETAILS</div>
        {guide.map((sec) => (
          <div key={sec.title} className="body-sm" style={{ lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>{sec.title}: </span>
            {sec.fields.map((f, i) => (
              <span key={f.label} style={{ color: 'var(--text-secondary)' }}>
                {f.label}
                {f.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                {i < sec.fields.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        ))}
        <div className="body-xs muted">Mention names, addresses, dates and amounts clearly. Leave out anything you don’t know — we’ll ask for it.</div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <textarea
            className="input"
            rows={6}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. Acme Traders is suing Sundar Rao before the City Civil Court, Bangalore for ₹8,50,000 unpaid for goods supplied. Cause of action arose on 12 March 2026. We seek recovery with interest and costs."
            aria-label="Matter brief"
          />
          {dictation.supported && (
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${dictation.listening ? 'active' : ''}`}
              onClick={dictate}
              title={dictation.listening ? 'Stop dictation' : 'Dictate'}
              aria-pressed={dictation.listening}
              style={{ position: 'absolute', right: 8, bottom: 8 }}
            >
              <Icon name={dictation.listening ? 'micOff' : 'mic'} size={14} />
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn" onClick={onSwitchToForm}>
            Fill the form instead
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={runExtract} disabled={!brief.trim() || extract.isPending}>
            <Icon name="research" size={14} /> {extract.isPending ? 'Reading…' : 'Extract fields'}
          </button>
        </div>
      </div>

      {summary && (
        <div
          className="col"
          style={{ gap: 12, padding: 'var(--space-4)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}
        >
          {extractedNothing ? (
            <p className="body-sm" style={{ margin: 0 }}>
              Couldn’t auto-fill from the brief{summary.modelUsed.startsWith('fallback') ? ' (AI drafting is off)' : ''}.
              Switch to the form to enter the details.
            </p>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge badge-sage">Captured {summary.captured}/{summary.total}</span>
                {summary.missing.length > 0 ? (
                  <span className="body-sm" style={{ color: 'var(--text-secondary)' }}>
                    Still needed: {summary.missing.join(', ')}
                  </span>
                ) : (
                  <span className="body-sm" style={{ color: 'var(--text-secondary)' }}>All required fields captured.</span>
                )}
              </div>
            </>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={onSwitchToForm}>
              {summary.missing.length > 0 ? 'Complete in form' : 'Review fields'}
            </button>
            <span className="spacer" style={{ flex: 1 }} />
            {!extractedNothing && (
              <button type="button" className="btn btn-primary" onClick={onGenerateNow}>
                <Icon name="draft" size={14} /> Generate now
              </button>
            )}
          </div>
          {summary.missing.length > 0 && !extractedNothing && (
            <span className="body-xs muted">
              Generating now produces a first draft with the gaps marked — you can fill them and regenerate to finish.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
