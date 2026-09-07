import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { AutoDraftResponse, PipelineResolvedSection } from '@lexdraft/types';
import { useAutoDraft, useKbSectionSearch, type LlmProvider, type KbSectionHit } from '@/hooks/useDrafting';
import { useDictation } from '@/hooks/useDictation';
import { contextToBriefPreamble, type DraftCaseContext } from '@/lib/draft-case-context';
import { DraftFormatModal } from './DraftFormatModal';
import { ClarifyPanel } from './ClarifyPanel';
import type { DraftFormatTemplate } from '@/hooks/useDraftTemplates';

interface Props {
  provider?: LlmProvider;
  /** Attached case: its particulars are prepended to the brief the agent reads. */
  caseContext?: DraftCaseContext | null;
  /** Called when the advocate accepts the drafted blocks (only when not blocked). */
  onAccept?: (draft: Record<string, string>, result: AutoDraftResponse) => void;
}

/**
 * The one-input drafting panel. The advocate describes the matter in plain
 * language — typed or dictated — and the agent decides the document, resolves
 * BNS/BNSS sections from the knowledge base, and drafts it. No tab-picking, no
 * doc-type selection, no field form.
 */
export function AutoDraftPanel({ provider, caseContext, onAccept }: Props) {
  const [brief, setBrief] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [format, setFormat] = useState<DraftFormatTemplate | null>(null);
  const [formatModalOpen, setFormatModalOpen] = useState(false);
  // Advocate-confirmed answers, folded into the brief on re-draft. Once they
  // have answered (or skipped) the clarification card, we don't ask again for
  // this brief — the panel would otherwise re-appear on every re-draft.
  const [clarifyAppendix, setClarifyAppendix] = useState('');
  const [clarifyResolved, setClarifyResolved] = useState(false);
  const dictation = useDictation();
  const auto = useAutoDraft();
  const result = auto.data ?? null;

  const toggleMic = () => {
    dictation.toggle((t) => setBrief((cur) => (cur ? `${cur} ${t}` : t)));
  };

  const run = (opts?: { docTypeOverride?: string; sectionsOverride?: string[]; briefAppendix?: string }) => {
    if (!brief.trim() || auto.isPending) return;
    setOverride(opts?.docTypeOverride ?? null);
    // A brand-new brief run (no override/appendix) means the advocate changed
    // the matter text — reset the clarification gate so they get asked afresh.
    if (!opts?.docTypeOverride && !opts?.sectionsOverride && opts?.briefAppendix === undefined) {
      setClarifyResolved(false);
      setClarifyAppendix('');
    }
    // Keep any previously-confirmed answers across doc-type / section re-drafts.
    const appendix = opts?.briefAppendix ?? clarifyAppendix;
    // Prepend the attached case's authoritative particulars so the agent drafts
    // against the real court/CNR/parties rather than inventing them.
    const base = caseContext
      ? `${contextToBriefPreamble(caseContext)}\n\n${brief.trim()}`
      : brief.trim();
    const fullBrief = appendix ? `${base}${appendix}` : base;
    auto.mutate({
      brief: fullBrief,
      ...(provider ? { provider } : {}),
      ...(opts?.docTypeOverride ? { docTypeOverride: opts.docTypeOverride } : {}),
      ...(opts?.sectionsOverride ? { sectionsOverride: opts.sectionsOverride } : {}),
      ...(format ? { templateFormat: format.body } : {}),
    });
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* ---- The single input: type or dictate the matter ---- */}
      <div className="card" style={{ padding: 'var(--space-5, 18px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <p className="body-sm muted" style={{ margin: 0 }}>
          Just say what happened — the agent works out which document to draft and the BNS/BNSS sections that apply.
        </p>
        <textarea
          className="input"
          rows={5}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. My client Ramesh was arrested yesterday for cheating — he took ₹4 lakh for a flat that never came. No prior record. We need bail before the Sessions Court."
          style={{ resize: 'vertical' }}
        />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm${format ? ' btn-secondary' : ''}`}
            onClick={() => setFormatModalOpen(true)}
            title="Draft into your own saved format"
          >
            <Icon name="documents" size={13} />
            {format ? `Format: ${format.name}` : 'Use my format'}
          </button>
          {format && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFormat(null)}
              title="Draft with the default skeleton"
            >
              <Icon name="close" size={12} /> Clear format
            </button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => run()}
            disabled={!brief.trim() || auto.isPending}
          >
            <Icon name="draft" size={14} /> {auto.isPending ? 'Understanding…' : 'Draft'}
          </button>
        </div>
      </div>

      <DraftFormatModal
        open={formatModalOpen}
        onClose={() => setFormatModalOpen(false)}
        selectedId={format?.id ?? null}
        onApply={(t) => { setFormat(t); setFormatModalOpen(false); }}
      />

      {auto.isError && (
        <div className="card" style={{ padding: 'var(--space-4, 14px)', borderColor: 'var(--red, var(--border-default))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={16} />
            <span className="body-sm">Drafting failed. Please retry.</span>
          </div>
        </div>
      )}

      {/* ---- Clarify-first: the agent needs facts, so ask before showing the
              draft. Gated on unresolved clarification + a pipeline result with
              questions. Answering folds the facts into the brief and re-drafts;
              skipping proceeds with blanks. Doc-type confirmation (needs
              Confirmation) takes precedence and is handled inside AutoResult. */}
      {result && result.pipeline && !result.needsConfirmation && !clarifyResolved
        && (result.pipeline.facts?.needs_clarification?.length ?? 0) > 0 ? (
        <ClarifyPanel
          questions={result.pipeline.facts!.needs_clarification!}
          docType={result.triage.docType}
          busy={auto.isPending}
          onDraft={(appendix) => {
            setClarifyAppendix(appendix);
            setClarifyResolved(true);
            run({ briefAppendix: appendix });
          }}
          onSkip={() => setClarifyResolved(true)}
        />
      ) : (
        result && (
          <AutoResult
            result={result}
            activeOverride={override}
            onSwitch={(dt) => run({ docTypeOverride: dt })}
            onReDraftWithSections={(ids) => run({ sectionsOverride: ids })}
            switching={auto.isPending}
            onAccept={onAccept}
          />
        )
      )}
    </div>
  );
}

function AutoResult({
  result,
  activeOverride,
  onSwitch,
  onReDraftWithSections,
  switching,
  onAccept,
}: {
  result: AutoDraftResponse;
  activeOverride: string | null;
  onSwitch: (docType: string) => void;
  onReDraftWithSections: (sectionIds: string[]) => void;
  switching: boolean;
  onAccept?: (draft: Record<string, string>, result: AutoDraftResponse) => void;
}) {
  const { triage } = result;
  const confColor =
    triage.confidence === 'high' ? 'badge-sage' : triage.confidence === 'medium' ? 'badge-amber' : 'badge-amber';

  // ---- Confirm-before-draft: the agent is uncertain, so it asks first ----
  // Guard BEFORE touching pipeline — it is null on this path.
  if (result.needsConfirmation || !result.pipeline) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="card" style={{ padding: 'var(--space-5, 18px)', display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--amber, var(--border-default))', background: 'var(--amber-tint, rgba(217,164,65,0.06))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={16} />
            <div className="heading-md">Confirm the document</div>
            <span className={`badge ${confColor}`}>{triage.confidence}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="body-sm muted">{triage.forum}</span>
          </div>
          <p className="body-sm" style={{ margin: 0 }}>
            The brief isn&apos;t conclusive, so I&apos;ve not drafted yet. My best read is <strong>{triage.docType}</strong> — {triage.reasoning}
          </p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={switching}
              onClick={() => onSwitch(triage.docType)}
              title={`Draft as ${triage.docType}`}
            >
              Draft as {triage.docType}
              {activeOverride === triage.docType && switching ? '…' : ''}
            </button>
            {triage.alternatives.map((alt) => (
              <button
                key={alt}
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={switching}
                onClick={() => onSwitch(alt)}
                title={`Draft as ${alt}`}
              >
                Draft as {alt}
                {activeOverride === alt && switching ? '…' : ''}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { pipeline } = result;
  const { sections, considerInstead, unresolvedOffences, draft, verify, blocked, advisories } = pipeline;
  const draftEntries = Object.entries(draft);

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* ---- What the agent understood ---- */}
      <div className="card" style={{ padding: 'var(--space-5, 18px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="check" size={16} />
          <div className="heading-md">Detected: {triage.docType}</div>
          <span className={`badge ${confColor}`}>{triage.confidence}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="body-sm muted">{triage.forum}</span>
        </div>
        <p className="body-sm" style={{ margin: 0 }}>{triage.reasoning}</p>
        {/* Override: not a required step — an unobtrusive "change this" affordance. */}
        <details>
          <summary className="body-sm muted" style={{ cursor: 'pointer' }}>Not the right document? Switch</summary>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {triage.alternatives.map((alt) => (
              <button
                key={alt}
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={switching}
                onClick={() => onSwitch(alt)}
                title={`Re-draft as ${alt}`}
              >
                {alt}
                {activeOverride === alt && switching ? '…' : ''}
              </button>
            ))}
          </div>
        </details>
      </div>

      {/* ---- AUDIT BLOCK: the safety gate ---- */}
      {blocked && (
        <div className="card" style={{ padding: 'var(--space-5, 18px)', borderColor: 'var(--red, #c0392b)', background: 'var(--red-tint, rgba(192,57,43,0.06))' }}>
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
              : 'issues that must be resolved'}. Resolve these before exporting.
          </p>
          {verify &&
            (verify.unauthorised_citations.length > 0 ||
              verify.old_law_references.length > 0 ||
              verify.placeholders_remaining.length > 0) && (
            <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {verify.unauthorised_citations.map((c) => (<li key={`u-${c}`}>Unauthorised citation: {c}</li>))}
              {verify.old_law_references.map((c) => (<li key={`o-${c}`}>Repealed-law reference (use BNS/BNSS/BSA): {c}</li>))}
              {verify.placeholders_remaining.map((c) => (<li key={`p-${c}`}>Unfilled placeholder: {c}</li>))}
            </ul>
          )}
        </div>
      )}

      {/* ---- Advisories ---- */}
      {advisories.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4, 14px)', borderColor: 'var(--amber, var(--border-default))' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="flag" size={14} />
            <span className="heading-sm">Advocate to confirm</span>
          </div>
          <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {advisories.map((a, i) => (<li key={i}>{a}</li>))}
          </ul>
        </div>
      )}

      {/* ---- Resolved sections — EDITABLE (add / remove / swap) ---- */}
      <SectionEditor
        sections={sections}
        considerInstead={considerInstead}
        onReDraft={onReDraftWithSections}
        busy={switching}
      />

      {unresolvedOffences.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4, 14px)' }}>
          <span className="body-sm">No knowledge-base match for: {unresolvedOffences.join(', ')}. Add these sections manually.</span>
        </div>
      )}

      {/* ---- Drafted blocks ---- */}
      {draftEntries.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-5, 18px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="heading-md">Draft</div>
          {draftEntries.map(([key, text]) => (
            <div key={key} className="col" style={{ gap: 4 }}>
              <span className="heading-sm" style={{ textTransform: 'capitalize' }}>{key}</span>
              <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
            </div>
          ))}
          {onAccept && (
            <div className="row" style={{ gap: 8 }}>
              <span className="spacer" style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked}
                title={blocked ? 'Resolve the audit issues before using this draft.' : 'Load this draft into the editor'}
                onClick={() => onAccept(draft, result)}
              >
                <Icon name="check" size={14} /> Use this draft
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionEditor — the advocate's control over the BNS/BNSS sections the agent
// resolved. Add (search the KB), remove (× a chip), or swap (remove + add), then
// "Re-draft with these sections" re-grounds the whole draft on exactly this set.
// ---------------------------------------------------------------------------
interface EditableSection {
  id: string;
  citation: string;
  offenceName: string;
  verified: boolean;
}

function SectionEditor({
  sections,
  considerInstead,
  onReDraft,
  busy,
}: {
  sections: PipelineResolvedSection[];
  considerInstead: Array<{ id: string; citation: string; offenceName: string; reason: string }>;
  onReDraft: (sectionIds: string[]) => void;
  busy: boolean;
}) {
  // Working set, seeded from the agent's pick. Edits here don't touch the draft
  // until the advocate presses "Re-draft with these sections".
  const [items, setItems] = useState<EditableSection[]>(() =>
    sections.map((s) => ({ id: s.id, citation: s.citation, offenceName: s.offenceName, verified: s.verified })),
  );
  const [q, setQ] = useState('');
  const kb = useKbSectionSearch();
  const results = kb.data?.items ?? [];

  const ids = items.map((i) => i.id);
  const dirty =
    ids.length !== sections.length || ids.some((id, i) => id !== sections[i]?.id);

  const add = (hit: KbSectionHit | { id: string; citation: string; offenceName: string; verified: boolean }) => {
    if (items.some((i) => i.id === hit.id)) return;
    setItems((cur) => [...cur, { id: hit.id, citation: hit.citation, offenceName: hit.offenceName, verified: hit.verified }]);
  };
  const remove = (id: string) => setItems((cur) => cur.filter((i) => i.id !== id));

  const runSearch = () => {
    const term = q.trim();
    if (term) kb.mutate(term);
  };

  return (
    <div className="card" style={{ padding: 'var(--space-5, 18px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <div className="heading-md">Applicable sections</div>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="body-xs muted">Add, remove, or swap — then re-draft</span>
      </div>

      {/* Current section chips */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {items.length === 0 && (
          <span className="body-sm muted">No sections selected. Search below to add one.</span>
        )}
        {items.map((s) => (
          <span
            key={s.id}
            className="badge"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingRight: 4 }}
            title={s.offenceName}
          >
            <span style={{ fontWeight: 600 }}>{s.citation}</span>
            <span className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.offenceName}
            </span>
            {s.verified
              ? <span className="badge badge-sage" style={{ fontSize: 9 }}>V</span>
              : <span className="badge badge-amber" style={{ fontSize: 9 }} title="Suggested — confirm before filing">S</span>}
            <button
              type="button"
              aria-label={`Remove ${s.citation}`}
              onClick={() => remove(s.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'inline-flex' }}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
      </div>

      {/* Quick-add from the agent's "consider instead" suggestions */}
      {considerInstead.filter((c) => !items.some((i) => i.id === c.id)).length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="body-xs muted">Agent suggests you might instead want:</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {considerInstead
              .filter((c) => !items.some((i) => i.id === c.id))
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title={c.reason}
                  onClick={() => add({ id: c.id, citation: c.citation, offenceName: c.offenceName, verified: false })}
                >
                  <Icon name="plus" size={11} /> {c.citation}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Search the KB to add a section by words or number */}
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="Add a section — e.g. 'criminal breach of trust' or '316'"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
        />
        <button type="button" className="btn" onClick={runSearch} disabled={kb.isPending || !q.trim()}>
          <Icon name="search" size={13} /> {kb.isPending ? 'Searching…' : 'Search'}
        </button>
      </div>
      {results.length > 0 && (
        <div className="col" style={{ gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {results.map((hit) => {
            const already = items.some((i) => i.id === hit.id);
            return (
              <button
                key={hit.id}
                type="button"
                className="row-clickable"
                disabled={already}
                onClick={() => add(hit)}
                style={{
                  textAlign: 'left', padding: '8px 10px', cursor: already ? 'default' : 'pointer',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)', opacity: already ? 0.5 : 1,
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{hit.citation}</span>
                  <span className="body-sm muted">{hit.offenceName}</span>
                  <span className="spacer" style={{ flex: 1 }} />
                  {already ? <span className="badge">added</span> : <Icon name="plus" size={12} />}
                </div>
                {hit.sectionTitle && (
                  <div className="body-xs muted" style={{ marginTop: 2 }}>{hit.sectionTitle}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Re-draft with the edited set */}
      <div className="row" style={{ gap: 8 }}>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || items.length === 0 || !dirty}
          title={!dirty ? 'Edit the sections to enable a re-draft' : 'Re-draft grounded on exactly these sections'}
          onClick={() => onReDraft(items.map((i) => i.id))}
        >
          <Icon name="draft" size={13} /> {busy ? 'Re-drafting…' : 'Re-draft with these sections'}
        </button>
      </div>
    </div>
  );
}
