import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { DraftBlockSpec, DraftPipelineResponse } from '@lexdraft/types';
import { usePipelineDraft, type LlmProvider } from '@/hooks/useDrafting';
import { useDictation } from '@/hooks/useDictation';

interface Props {
  docType: string;
  forum: string;
  /** Required field keys from the skeleton (drives clarifying questions). */
  requiredFields?: string[];
  /** The blocks the skeleton wants drafted; sensible defaults for a bail app. */
  blocks?: DraftBlockSpec[];
  provider?: LlmProvider;
  /** Called when the advocate accepts the drafted blocks (only when not blocked). */
  onAccept?: (draft: Record<string, string>, result: DraftPipelineResponse) => void;
}

const DEFAULT_BLOCKS: DraftBlockSpec[] = [
  { block: 'facts', instruction: 'Narrate the facts chronologically in formal legal English.' },
  { block: 'grounds', instruction: 'State the legal grounds, citing only the resolved sections.' },
  { block: 'prayer', instruction: 'State the precise relief sought.' },
];

/**
 * Drives the grounded four-stage pipeline: the advocate types or dictates the
 * matter, the AI resolves BNS/BNSS sections from the knowledge base, drafts the
 * blocks, and self-audits. Sections are shown as VERIFIED (counsel-checked) or
 * SUGGESTED (must be confirmed). Export is disabled when the audit is `blocked`.
 */
export function DraftPipelinePanel({
  docType,
  forum,
  requiredFields,
  blocks = DEFAULT_BLOCKS,
  provider,
  onAccept,
}: Props) {
  const [brief, setBrief] = useState('');
  const dictation = useDictation();
  const pipeline = usePipelineDraft();
  const result = pipeline.data ?? null;

  const toggleMic = () => {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    dictation.start((t) => setBrief((cur) => (cur ? `${cur} ${t}` : t)));
  };

  const run = () => {
    if (!brief.trim() || pipeline.isPending) return;
    pipeline.mutate({
      docType,
      forum,
      brief: brief.trim(),
      ...(requiredFields ? { requiredFields } : {}),
      blocks,
      ...(provider ? { provider } : {}),
    });
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* ---- Input: type or dictate the matter ---- */}
      <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="draft" size={16} />
          <div className="heading-md">Describe the matter</div>
          <span className="spacer" style={{ flex: 1 }} />
          {dictation.supported && (
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${dictation.listening ? 'active' : ''}`}
              onClick={toggleMic}
              aria-pressed={dictation.listening}
              title={dictation.listening ? 'Stop dictation' : 'Dictate the matter'}
            >
              <Icon name={dictation.listening ? 'micOff' : 'mic'} size={14} />
              {dictation.listening ? ' Stop' : ' Dictate'}
            </button>
          )}
        </div>
        <textarea
          className="input"
          rows={5}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Client Ramesh arrested 5 Aug in FIR 112/2025, alleged cheating of Rs 4,00,000, no prior record, seeks regular bail before the Sessions Court…"
          style={{ resize: 'vertical' }}
        />
        <div className="row" style={{ gap: 8 }}>
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={run} disabled={!brief.trim() || pipeline.isPending}>
            <Icon name="draft" size={14} /> {pipeline.isPending ? 'Working…' : 'Draft with AI'}
          </button>
        </div>
      </div>

      {pipeline.isError && (
        <div className="card" style={{ padding: 'var(--space-4)', borderColor: 'var(--red, var(--border-default))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={16} />
            <span className="body-sm">Drafting failed. Please retry.</span>
          </div>
        </div>
      )}

      {result && <PipelineResult result={result} onAccept={onAccept} />}
    </div>
  );
}

function PipelineResult({
  result,
  onAccept,
}: {
  result: DraftPipelineResponse;
  onAccept?: (draft: Record<string, string>, result: DraftPipelineResponse) => void;
}) {
  const { sections, considerInstead, unresolvedOffences, draft, verify, blocked, advisories, facts } = result;
  const draftEntries = Object.entries(draft);
  const offline = result.modelUsed === 'fallback:none';

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* ---- AUDIT BLOCK: the safety gate ---- */}
      {blocked && (
        <div className="card" style={{ padding: 'var(--space-5)', borderColor: 'var(--red, #c0392b)', background: 'var(--red-tint, rgba(192,57,43,0.06))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={16} />
            <div className="heading-md">Review required before export</div>
          </div>
          <p className="body-sm" style={{ margin: '8px 0 0' }}>
            The self-audit found {verify
              ? [
                  verify.unauthorised_citations.length > 0 ? 'citations that were not authorised' : null,
                  verify.old_law_references.length > 0 ? 'references to repealed law' : null,
                  verify.placeholders_remaining.length > 0 ? 'unfilled placeholders' : null,
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'issues that must be resolved'}. Export is disabled until you resolve these.
          </p>
          {verify &&
            (verify.unauthorised_citations.length > 0 ||
              verify.old_law_references.length > 0 ||
              verify.placeholders_remaining.length > 0) && (
              <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {verify.unauthorised_citations.map((c) => (
                  <li key={`u-${c}`}>Unauthorised citation: {c}</li>
                ))}
                {verify.old_law_references.map((c) => (
                  <li key={`o-${c}`}>Repealed-law reference (use BNS/BNSS/BSA): {c}</li>
                ))}
                {verify.placeholders_remaining.map((c) => (
                  <li key={`p-${c}`}>Unfilled placeholder: {c}</li>
                ))}
              </ul>
            )}
        </div>
      )}

      {offline && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <span className="body-sm muted">AI is offline — resolve sections and draft manually.</span>
        </div>
      )}

      {/* ---- Advisories ---- */}
      {advisories.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4)', borderColor: 'var(--amber, var(--border-default))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={14} />
            <span className="heading-sm">Advocate to confirm</span>
          </div>
          <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {advisories.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Resolved sections (VERIFIED vs SUGGESTED) ---- */}
      {sections.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="heading-md">Applicable sections</div>
          {sections.map((s) => (
            <div key={s.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="body-sm" style={{ fontWeight: 600 }}>
                {s.citation}
              </span>
              <span className="body-sm muted">{s.offenceName}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {s.confidence && <span className="badge">{s.confidence}</span>}
              {s.verified ? (
                <span className="badge badge-sage">Verified</span>
              ) : (
                <span className="badge badge-amber" title="Not counsel-verified — cited hedged; confirm before filing.">
                  Suggested
                </span>
              )}
            </div>
          ))}
          {sections.some((s) => s.ingredientsMissing && s.ingredientsMissing.length > 0) && (
            <p className="body-sm muted" style={{ margin: 0 }}>
              Some ingredients may not be established by the facts — review each highlighted section.
            </p>
          )}
        </div>
      )}

      {/* ---- Alternatives the AI flagged ---- */}
      {considerInstead.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <span className="heading-sm">Consider instead</span>
          <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {considerInstead.map((c) => (
              <li key={c.id}>
                <strong>{c.citation}</strong> ({c.offenceName}) — {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unresolvedOffences.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <span className="body-sm">
            No knowledge-base match for: {unresolvedOffences.join(', ')}. Add these sections manually.
          </span>
        </div>
      )}

      {/* ---- Drafted blocks ---- */}
      {draftEntries.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="heading-md">Draft</div>
          {draftEntries.map(([key, text]) => (
            <div key={key} className="col" style={{ gap: 4 }}>
              <span className="heading-sm" style={{ textTransform: 'capitalize' }}>
                {key}
              </span>
              <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {text}
              </p>
            </div>
          ))}
          {onAccept && (
            <div className="row" style={{ gap: 8 }}>
              <span className="spacer" style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked}
                title={blocked ? 'Resolve the audit issues before exporting.' : 'Use this draft'}
                onClick={() => onAccept(draft, result)}
              >
                <Icon name="check" size={14} /> Use this draft
              </button>
            </div>
          )}
        </div>
      )}

      {facts.facts_narrative && draftEntries.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <span className="body-sm muted">Facts extracted; no draft blocks were produced. Review and draft manually.</span>
        </div>
      )}
    </div>
  );
}
