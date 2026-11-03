// =============================================================================
// DraftRevisePanel — redraft instructions on a finished draft.
//
// The advocate types what to change; the API returns PROPOSED paragraph edits
// (POST /drafting/revise). Nothing touches the draft until they press Accept.
// Untouched paragraphs stay identical, so in-place edits keep the engine .docx
// court layout on download. Guard warnings (citations / figures that appear in
// neither the draft nor the instruction) are shown before accepting.
//
// Scope: the whole draft, one detected section ("Grounds"), a paragraph range,
// or the text selected in the preview. The API enforces the range (edits
// outside it are dropped) and auto-scopes an instruction that names a section.
//
// The AI review's "Apply fix" arrives here as a `request` (source: 'review'),
// so a fix goes through exactly this proposal / accept flow and guard.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';
import { detectSections, rangeFromSelection } from '@/lib/draft-sections';
import '@/styles/chambers/draft-tools.css';

interface ReviseResult {
  paragraphs: string[];
  changed: number[];
  inserted: number;
  diff: Array<{ index: number; before: string; after: string | null }>;
  added: string[];
  summary: string;
  questions: string[];
  warnings: string[];
  /** Range the edits were limited to (absent on older API builds). */
  scope?: { from: number; to: number; label: string | null } | null;
}

/** A redraft started from elsewhere (the review card's "Apply fix"). */
export interface RedraftRequest {
  id: number;
  instruction: string;
  focus?: { from: number; to: number };
  source: 'review';
  /** Shown above the proposal, e.g. "Fix from review: Limitation". */
  label?: string;
}

const QUICK = ['Make the prayer firmer', 'Make it more concise', 'Fix grammar and formal tone'];
const SECTION_QUICK: Record<string, string> = { ground: 'Rewrite the grounds stronger', fact: 'Tighten the facts' };

type ScopeChoice = 'all' | 'range' | `s${number}`;

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function DraftRevisePanel({
  docType,
  paragraphs,
  onAccept,
  request,
}: {
  docType: string;
  paragraphs: string[];
  onAccept: (paragraphs: string[], layoutKept: boolean) => void | Promise<void>;
  request?: RedraftRequest | null;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ base: string[]; result: ReviseResult; label?: string } | null>(null);
  const [scope, setScope] = useState<ScopeChoice>('all');
  const [range, setRange] = useState({ from: 1, to: 1 }); // 1-based, as shown
  const [selection, setSelection] = useState('');
  const cardRef = useRef<HTMLElement | null>(null);

  const sections = useMemo(() => detectSections(paragraphs), [paragraphs]);
  const total = paragraphs.length;

  // Remember the last text selected inside the document preview/editor, so
  // "Use selected text" still works after the click moves focus.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const text = sel?.toString() ?? '';
      const node = sel?.anchorNode;
      const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
      if (text.trim() && el?.closest('.dw-paper-wrap')) setSelection(text);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const selRange = useMemo(() => (selection ? rangeFromSelection(paragraphs, selection) : null), [selection, paragraphs]);

  // A section choice can outlive a redraft that removed it.
  useEffect(() => {
    if (scope.startsWith('s') && !sections[Number(scope.slice(1))]) setScope('all');
  }, [scope, sections]);

  const focus = useMemo((): { from: number; to: number } | undefined => {
    if (scope === 'all') return undefined;
    if (scope === 'range') {
      const from = Math.min(Math.max(1, range.from), total) - 1;
      const to = Math.min(Math.max(range.from, range.to), total) - 1;
      return { from, to };
    }
    const s = sections[Number(scope.slice(1))];
    return s ? { from: s.from, to: s.to } : undefined;
  }, [scope, range, sections, total]);

  const submit = async (
    text: string,
    opts: { focus?: { from: number; to: number }; source?: 'review'; label?: string } = {},
  ) => {
    const ins = text.trim();
    if (ins.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const result = await api.post<ReviseResult>('/drafting/revise', {
        docType, instruction: ins, paragraphs,
        ...(opts.focus ? { focus: opts.focus } : {}),
        ...(opts.source ? { source: opts.source } : {}),
      });
      setProposal({ base: paragraphs, result, ...(opts.label ? { label: opts.label } : {}) });
    } catch (err) {
      setError((err as Error).message || 'Could not revise the draft');
    } finally {
      setBusy(false);
    }
  };

  // A fix sent from the review card: run it and bring this card into view.
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    // While another redraft runs, wait; this re-runs when `busy` clears.
    if (!request || request.id === lastRequest.current || busy) return;
    lastRequest.current = request.id;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    void submit(request.instruction, {
      ...(request.focus ? { focus: request.focus } : {}),
      source: request.source,
      label: request.label ?? 'Fix from review',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, busy]);

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
  const sectionQuick = sections.flatMap((s, i) => {
    const key = Object.keys(SECTION_QUICK).find((k) => s.title.toLowerCase().includes(k));
    return key ? [{ text: SECTION_QUICK[key]!, scope: `s${i}` as ScopeChoice }] : [];
  });

  return (
    <section className="dc-card" ref={cardRef}>
      <div className="dc-eyebrow">Redraft</div>

      {!proposal && (
        <>
          <textarea
            className="input"
            rows={3}
            value={instruction}
            placeholder="Tell DifAi what to change, e.g. add interest at 18% p.a. from the date of notice"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(instruction, focus ? { focus } : {});
            }}
            disabled={busy}
          />

          <div className="dt-scope">
            <div className="dt-scope-row">
              <label htmlFor="dt-scope-select">Change</label>
              <select
                id="dt-scope-select"
                className="input"
                value={scope}
                disabled={busy}
                onChange={(e) => setScope(e.target.value as ScopeChoice)}
              >
                <option value="all">the whole draft</option>
                {sections.map((s, i) => (
                  <option key={`${s.title}-${s.from}`} value={`s${i}`}>
                    only {short(s.title, 40)} (paras {s.from + 1}–{s.to + 1})
                  </option>
                ))}
                <option value="range">only paragraphs…</option>
              </select>
            </div>
            {scope === 'range' && (
              <div className="dt-scope-row">
                <span>From</span>
                <input
                  className="input dt-num" type="number" inputMode="numeric" min={1} max={total} aria-label="From paragraph"
                  value={range.from} disabled={busy}
                  onChange={(e) => setRange((r0) => ({ ...r0, from: Number(e.target.value) || 1 }))}
                />
                <span>to</span>
                <input
                  className="input dt-num" type="number" inputMode="numeric" min={1} max={total} aria-label="To paragraph"
                  value={range.to} disabled={busy}
                  onChange={(e) => setRange((r0) => ({ ...r0, to: Number(e.target.value) || 1 }))}
                />
                <span>of {total}</span>
              </div>
            )}
            {focus && (
              <div className="dt-scope-preview">
                {focus.from === focus.to
                  ? `¶${focus.from + 1}: ${short(paragraphs[focus.from] ?? '')}`
                  : `¶${focus.from + 1}: ${short(paragraphs[focus.from] ?? '', 50)} … ¶${focus.to + 1}: ${short(paragraphs[focus.to] ?? '', 50)}`}
              </div>
            )}
            {selRange && !(scope === 'range' && focus?.from === selRange.from && focus?.to === selRange.to) && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()} // keep the selection
                onClick={() => {
                  setRange({ from: selRange.from + 1, to: selRange.to + 1 });
                  setScope('range');
                }}
              >
                Use selected text (¶{selRange.from + 1}{selRange.to !== selRange.from ? `–${selRange.to + 1}` : ''})
              </button>
            )}
          </div>

          <div className="dw-btn-row dw-quick">
            {QUICK.map((q) => (
              <button key={q} className="chip dw-quick-chip" type="button" disabled={busy} onClick={() => void submit(q, focus ? { focus } : {})}>
                {q}
              </button>
            ))}
            {sectionQuick.map((q) => (
              <button
                key={q.text} className="chip dw-quick-chip" type="button" disabled={busy}
                onClick={() => {
                  setScope(q.scope);
                  const s = sections[Number(q.scope.slice(1))];
                  void submit(q.text, s ? { focus: { from: s.from, to: s.to } } : {});
                }}
              >
                {q.text}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary dw-wide" type="button"
            disabled={busy || instruction.trim().length < 3}
            onClick={() => void submit(instruction, focus ? { focus } : {})}
          >
            <Icon name="edit" size={14} /> {busy ? 'Redrafting…' : 'Redraft'}
          </button>
          {error && <p className="dc-card-text">{error}</p>}
          <p className="dc-card-text">
            Changes only what you ask, inside the part you choose. Facts you don&apos;t give are left as ____ blanks. You review every change before it is applied.
          </p>
        </>
      )}

      {proposal && r && (
        <>
          {proposal.label && <div className="dw-group-title">{proposal.label}</div>}
          {r.summary && <p className="dc-card-text">{r.summary}</p>}
          {r.scope && (
            <p className="dw-note">
              Limited to {r.scope.label ? `${r.scope.label} · ` : ''}paragraphs {r.scope.from + 1}–{r.scope.to + 1}
            </p>
          )}

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
