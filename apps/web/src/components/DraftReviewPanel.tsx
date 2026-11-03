// =============================================================================
// DraftReviewPanel — "Review this draft": a senior-counsel critique in the
// composer rail (POST /drafting/review).
//
// Findings only — nothing here edits the draft. "Apply fix" hands the finding's
// fix to the Redraft card (onApplyFix), which sends it to /drafting/revise with
// source 'review', so the advocate sees the same before/after proposal, the same
// citation/figure guard, and accepts or discards. A fix that would need a fact
// the draft doesn't have shows "Needs: …" instead of inventing one.
//
// Colour: black and white. The ONLY red is the Apply button of a MANDATORY
// finding, which names that issue (the app-wide rule for red).
// =============================================================================

import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';
import '@/styles/chambers/draft-tools.css';

export type ReviewSeverity = 'mandatory' | 'important' | 'minor';

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  category: 'grounds' | 'limitation' | 'jurisdiction' | 'averment' | 'facts' | 'prayer' | 'format' | 'other';
  paragraph: number | null;
  excerpt: string | null;
  issue: string;
  fix: string | null;
  needs: string[];
  warnings: string[];
}

interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
}

const CATEGORY_LABEL: Record<ReviewFinding['category'], string> = {
  grounds: 'Grounds', limitation: 'Limitation', jurisdiction: 'Jurisdiction', averment: 'Averment',
  facts: 'Facts', prayer: 'Prayer', format: 'Format', other: 'Other',
};
const SEVERITY_LABEL: Record<ReviewSeverity, string> = { mandatory: 'Mandatory', important: 'Important', minor: 'Minor' };

const sameDraft = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** Where a finding's paragraph is in the CURRENT draft: the same index when the
 *  draft is unchanged, else the paragraph that still starts with the excerpt
 *  (null when it can't be found, so the fix runs on the whole draft). */
function locate(f: ReviewFinding, base: string[], now: string[]): number | null {
  if (f.paragraph === null) return null;
  if (sameDraft(base, now)) return f.paragraph;
  if (now[f.paragraph] === base[f.paragraph]) return f.paragraph;
  const head = (f.excerpt ?? '').replace(/…$/, '');
  const i = head ? now.findIndex((p) => p.trim().startsWith(head)) : -1;
  return i >= 0 ? i : null;
}

export function DraftReviewPanel({
  docType,
  paragraphs,
  onApplyFix,
}: {
  docType: string;
  paragraphs: string[];
  /** Send a fix through the Redraft flow. `focus` limits it to the paragraph. */
  onApplyFix: (fix: { instruction: string; focus?: { from: number; to: number }; label: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ base: string[]; result: ReviewResult } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ReviewResult>('/drafting/review', { docType, paragraphs });
      setReview({ base: paragraphs, result });
      setDone(new Set());
    } catch (err) {
      setError((err as Error).message || 'Could not review the draft');
    } finally {
      setBusy(false);
    }
  };

  const changed = !!review && !sameDraft(review.base, paragraphs);
  const tally = useMemo(() => {
    const t: Record<ReviewSeverity, number> = { mandatory: 0, important: 0, minor: 0 };
    for (const f of review?.result.findings ?? []) t[f.severity] += 1;
    return t;
  }, [review]);

  const apply = (f: ReviewFinding) => {
    if (!f.fix || !review) return;
    // Inconsistent facts and prayer-vs-grounds findings span paragraphs, so their
    // fix is not pinned to the one paragraph named.
    const at = f.category === 'facts' || f.category === 'prayer' ? null : locate(f, review.base, paragraphs);
    // Missing facts become ____ blanks in the redraft, never invented values.
    const needs = f.needs.length ? ` Leave ____ for: ${f.needs.join('; ')}.` : '';
    onApplyFix({
      instruction: `${f.fix}${needs}`,
      ...(at !== null ? { focus: { from: at, to: at } } : {}),
      label: `Fix from review: ${CATEGORY_LABEL[f.category]}`,
    });
    setDone((s) => new Set(s).add(f.id));
  };

  return (
    <section className="dc-card">
      <div className="dw-card-head">
        <div className="dc-eyebrow">Review</div>
        {review && review.result.findings.length > 0 && <span className="dw-count">{review.result.findings.length}</span>}
      </div>

      {!review && (
        <>
          <button className="btn dw-wide" type="button" disabled={busy} onClick={() => void run()}>
            <Icon name="review" size={14} /> {busy ? 'Reviewing…' : 'Review this draft'}
          </button>
          <p className="dc-card-text">
            A senior-counsel read: grounds, limitation, jurisdiction, mandatory averments, inconsistent facts, the prayer and form. Nothing changes until you apply a fix.
          </p>
        </>
      )}

      {error && <p className="dc-card-text">{error}</p>}

      {review && (
        <>
          {review.result.summary && <p className="dc-card-text">{review.result.summary}</p>}
          {review.result.findings.length > 0 ? (
            <div className="dt-tally" aria-label="Findings by severity">
              {(['mandatory', 'important', 'minor'] as const).map((s) => tally[s] > 0 && (
                <span key={s}><strong>{tally[s]}</strong> {SEVERITY_LABEL[s].toLowerCase()}</span>
              ))}
            </div>
          ) : (
            <p className="dc-card-text">No issues found. Still read it once before filing.</p>
          )}
          {changed && <p className="dw-note">The draft has changed since this review. Fixes still go to the same paragraph where it can be found.</p>}

          <ul className="dt-findings">
            {review.result.findings.map((f) => {
              const isDone = done.has(f.id);
              const mandatory = f.severity === 'mandatory';
              return (
                <li key={f.id} className={`dt-finding${isDone ? ' is-done' : ''}`}>
                  <div className="dt-meta">
                    <span className={mandatory ? 'dt-sev--mandatory' : undefined}>{SEVERITY_LABEL[f.severity]}</span>
                    <span>· {CATEGORY_LABEL[f.category]}</span>
                    <span>· {f.paragraph === null ? 'Whole draft' : `¶${f.paragraph + 1}`}</span>
                  </div>
                  <p className="dt-issue">{f.issue}</p>
                  {f.fix && <p className="dt-fix">Suggested: {f.fix}</p>}
                  {f.needs.map((n) => <p key={n} className="dt-needs">Needs: {n}</p>)}
                  {f.warnings.length > 0 && (
                    <ul className="dw-items">{f.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  )}
                  {f.fix && (
                    <div className="dt-actions">
                      <button
                        type="button"
                        className={`btn btn-sm${mandatory && !isDone ? ' btn-danger' : ''}`}
                        onClick={() => apply(f)}
                        title="Opens the change in Redraft for you to accept or discard"
                      >
                        {isDone
                          ? 'Sent to Redraft · apply again'
                          : mandatory ? `Fix mandatory: ${CATEGORY_LABEL[f.category]}` : 'Apply fix'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="dw-btn-row">
            <button className="btn" type="button" disabled={busy} onClick={() => void run()}>
              {busy ? 'Reviewing…' : 'Review again'}
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setReview(null)}>
              Close
            </button>
          </div>
          <p className="dc-card-text">AI review. It can miss points or be wrong; the decision is yours.</p>
        </>
      )}
    </section>
  );
}
