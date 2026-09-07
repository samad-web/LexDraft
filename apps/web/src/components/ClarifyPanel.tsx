import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { classifyQuestions, answersToBriefAppendix, type ClarifyField } from '@/lib/draft-clarify';

// =============================================================================
// ClarifyPanel — the fast "confirm a few things, then draft" card.
//
// When the agent needs facts it doesn't have, it returns them as questions
// (needs_clarification). Instead of drafting with guesses OR dumping a passive
// checklist after the fact, we ask them up front — all on ONE card, answered in
// seconds: smart option chips where the answer is known, a text field for the
// one or two facts only the advocate holds. Sensible defaults are pre-selected
// so an advocate in a hurry can glance and hit Draft.
//
// Unanswered questions are simply left blank — they become ____ placeholders in
// the draft, never invented values. That keeps the anti-hallucination guarantee
// while making the gaps quick to fill.
// =============================================================================

interface Props {
  /** The agent's needs_clarification questions. */
  questions: string[];
  /** The doc type the agent detected — shown so the advocate has context. */
  docType: string;
  /** Whether a re-draft is currently running. */
  busy?: boolean;
  /** Called with the appendix to fold into the brief, then re-draft. */
  onDraft: (briefAppendix: string) => void;
  /** Draft anyway with whatever's filled (blanks become placeholders). */
  onSkip: () => void;
}

export function ClarifyPanel({ questions, docType, busy, onDraft, onSkip }: Props) {
  const fields = useMemo(() => classifyQuestions(questions), [questions]);

  // Seed choice questions with their smart default (first option) so an
  // untouched card still resolves to a sensible draft. Text fields start empty.
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) {
      if (f.kind === 'choice' && f.options?.length) seed[f.key] = f.options[0]!;
    }
    return seed;
  });

  const set = (key: string, value: string) =>
    setAnswers((cur) => ({ ...cur, [key]: value }));

  const answeredCount = fields.filter((f) => (answers[f.key] ?? '').trim().length > 0).length;

  const submit = () => {
    if (busy) return;
    onDraft(answersToBriefAppendix(fields, answers));
  };

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-5, 18px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        borderColor: 'var(--accent, var(--border-strong))',
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="flag" size={16} />
        <div className="heading-md">A few quick details</div>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="body-sm muted">{docType}</span>
      </div>
      <p className="body-sm muted" style={{ margin: 0 }}>
        Tap the right option or type the fact — anything you leave blank stays a fill-in blank in the
        draft, never guessed. {answeredCount}/{fields.length} answered.
      </p>

      <div className="col" style={{ gap: 16 }}>
        {fields.map((f) => (
          <QuestionRow key={f.key} field={f} value={answers[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
        ))}
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 2 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onSkip}
          disabled={busy}
          title="Draft now with blanks for anything not filled"
        >
          Skip — draft with blanks
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          <Icon name="draft" size={14} /> {busy ? 'Drafting…' : 'Draft with these answers'}
        </button>
      </div>
    </div>
  );
}

function QuestionRow({
  field,
  value,
  onChange,
}: {
  field: ClarifyField;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = field.question.replace(/\s*\?\s*$/, '');
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="body-sm" style={{ fontWeight: 600 }}>{label}</label>

      {field.kind === 'choice' && field.options && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {field.options.map((opt) => {
            const active = value === opt;
            return (
              <button
                key={opt}
                type="button"
                className={`btn btn-sm${active ? ' btn-primary' : ' btn-ghost'}`}
                aria-pressed={active}
                onClick={() => onChange(active ? '' : opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {field.kind === 'text' && (
        <input
          className="input"
          value={value}
          placeholder={field.hint ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ maxWidth: 480 }}
        />
      )}

      {field.kind === 'longtext' && (
        <textarea
          className="input"
          rows={3}
          value={value}
          placeholder={field.hint ?? 'Briefly, in your own words…'}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      )}
    </div>
  );
}
