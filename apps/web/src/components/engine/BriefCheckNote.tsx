import type { BriefCheck } from '@/hooks/useIntake';

/** The result of "Check what's missing": the document the text is for and the facts still to add. */
export function BriefCheckNote({ check }: { check: BriefCheck | null }) {
  if (!check) return null;
  const doc = check.title ? `a ${check.title}` : 'this document';
  return (
    <div className="body-sm" role="status" style={{ margin: '8px 0', padding: 12, border: '1px solid currentColor', borderRadius: 8 }}>
      {check.question ? (
        <p style={{ margin: 0 }}>This reads as a question. Submit it and DifAi will answer it.</p>
      ) : check.missing.length === 0 ? (
        <p style={{ margin: 0 }}>Nothing important looks missing for {doc}. You can draft it.</p>
      ) : (
        <>
          <p style={{ margin: '0 0 6px' }}>For {doc}, add these if you have them:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {check.missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="body-xs" style={{ margin: '6px 0 0' }}>You can still draft now: anything not given is left as a [blank].</p>
        </>
      )}
    </div>
  );
}
