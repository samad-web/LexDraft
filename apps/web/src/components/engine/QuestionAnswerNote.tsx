import type { DraftBoxAnswer } from '@/hooks/useIntake';

/** The answer to a question typed in the Draft box, with what to check before relying on it. */
export function QuestionAnswerNote({ answer }: { answer: DraftBoxAnswer | null }) {
  if (!answer) return null;
  return (
    <div className="body-sm" role="status" style={{ margin: '8px 0', padding: 12, border: '1px solid currentColor', borderRadius: 8 }}>
      {answer.text.split(/\n{2,}/).map((p, i) => <p key={i} style={{ margin: '0 0 8px' }}>{p}</p>)}
      {answer.verify.length > 0 && (
        <p style={{ margin: '0 0 8px' }}>Check against the bare Act before relying on it: {answer.verify.join('; ')}.</p>
      )}
      {answer.draftOffer && (
        <p style={{ margin: '0 0 8px' }}>To draft a {answer.draftOffer}, describe the matter and Submit.</p>
      )}
      <p className="body-xs" style={{ margin: 0, fontWeight: 600 }}>Answered by AI. Please verify before relying on it.</p>
    </div>
  );
}
