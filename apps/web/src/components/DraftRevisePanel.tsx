// =============================================================================
// DraftRevisePanel — one-line redraft instructions on a finished draft.
//
// The advocate types what to change; the API returns PROPOSED paragraph edits
// (POST /drafting/revise). Nothing touches the draft until they press Accept.
// Untouched paragraphs stay identical, so in-place edits keep the engine .docx
// court layout on download. Guard warnings (citations / figures that appear in
// neither the draft nor the instruction) are shown before accepting.
// =============================================================================

import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';

interface ReviseResult {
  paragraphs: string[];
  changed: number[];
  inserted: number;
  diff: Array<{ index: number; before: string; after: string | null }>;
  added: string[];
  summary: string;
  questions: string[];
  warnings: string[];
}

const QUICK = ['Make the prayer firmer', 'Make it more concise', 'Fix grammar and formal tone'];

export function DraftRevisePanel({
  docType,
  paragraphs,
  onAccept,
}: {
  docType: string;
  paragraphs: string[];
  onAccept: (paragraphs: string[], layoutKept: boolean) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ base: string[]; result: ReviseResult } | null>(null);

  const submit = async (text: string) => {
    const ins = text.trim();
    if (ins.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const result = await api.post<ReviseResult>('/drafting/revise', { docType, instruction: ins, paragraphs });
      setProposal({ base: paragraphs, result });
    } catch (err) {
      setError((err as Error).message || 'Could not revise the draft');
    } finally {
      setBusy(false);
    }
  };

  const discard = () => setProposal(null);
  const accept = () => {
    if (!proposal) return;
    const { result } = proposal;
    onAccept(result.paragraphs, result.paragraphs.length === proposal.base.length);
    setProposal(null);
    setInstruction('');
  };

  const r = proposal?.result;
  const hasChange = !!r && (r.diff.length > 0 || r.added.length > 0);

  return (
    <section className="dc-card">
      <div className="dc-eyebrow">Redraft</div>

      {!proposal && (
        <>
          <textarea
            className="input"
            rows={3}
            value={instruction}
            placeholder="Tell LexDraft what to change, e.g. add interest at 18% p.a. from the date of notice"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(instruction);
            }}
            disabled={busy}
          />
          <div className="dw-btn-row">
            {QUICK.map((q) => (
              <button key={q} className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => void submit(q)}>
                {q}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary dw-wide" type="button"
            disabled={busy || instruction.trim().length < 3}
            onClick={() => void submit(instruction)}
          >
            <Icon name="edit" size={14} /> {busy ? 'Redrafting…' : 'Redraft'}
          </button>
          {error && <p className="dc-card-text">{error}</p>}
          <p className="dc-card-text">
            Changes only what you ask. Facts you don&apos;t give are left as ____ blanks. You review every change before it is applied.
          </p>
        </>
      )}

      {proposal && r && (
        <>
          {r.summary && <p className="dc-card-text">{r.summary}</p>}

          {!hasChange && <p className="dc-card-text">No changes were proposed.</p>}

          {r.diff.length > 0 && (
            <div className="dw-group">
              <div className="dw-group-title">Changed paragraphs · {r.diff.length}</div>
              <ul className="dw-items dw-items--plain">
                {r.diff.map((d) => (
                  <li key={d.index}>
                    <div className="dw-old">{d.before}</div>
                    {d.after !== null ? <div>{d.after}</div> : <div className="dw-note">Removed</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.added.length > 0 && (
            <div className="dw-group">
              <div className="dw-group-title">New paragraphs · {r.added.length}</div>
              <ul className="dw-items dw-items--plain">
                {r.added.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {r.warnings.length > 0 && (
            <div className="dw-group">
              <div className="dw-group-title">Check before accepting · {r.warnings.length}</div>
              <ul className="dw-items">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}

          {r.questions.length > 0 && (
            <div className="dw-group">
              <div className="dw-group-title">Left blank for you to fill</div>
              <ul className="dw-items">{r.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}

          {hasChange && r.paragraphs.length !== proposal.base.length && (
            <p className="dw-note">Paragraphs were added or removed, so the Word download will use a simplified layout.</p>
          )}

          <div className="dw-btn-row">
            {hasChange && (
              <button className="btn btn-primary" type="button" onClick={accept}>
                <Icon name="check" size={14} /> Accept
              </button>
            )}
            <button className="btn" type="button" onClick={discard}>
              {hasChange ? 'Discard' : 'Back'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
