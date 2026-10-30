import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useAskResearch } from '@/hooks/useResearch';
import {
  useLawsSearch,
  useSignedPdfUrl,
  CANONICAL_STATES,
  type LawHit,
} from '@/hooks/useLawsSearch';
import { JurisdictionBadge } from '@/components/JurisdictionBadge';
import { VerificationBadge } from '@/components/VerificationBadge';
import { PageHeader } from '@/components/PageHeader';

type ScopeKind = 'all' | 'central' | 'state';
import { useUIStore } from '@/store/ui';

type Mode = 'ask' | 'corpus';

const SUGGESTIONS: string[] = [];

function formatBrief(query: string, answer: string, citations: { title: string; court: string; citation: string; excerpt: string }[]): string {
  const parts: string[] = [];
  parts.push(`Question: ${query}`);
  parts.push('');
  parts.push('Answer:');
  parts.push(answer);
  if (citations.length > 0) {
    parts.push('');
    parts.push('Authorities:');
    for (const c of citations) {
      parts.push(`- ${c.title} (${c.court}, ${c.citation})`);
      if (c.excerpt) parts.push(`  ${c.excerpt}`);
    }
  }
  return parts.join('\n');
}

export function ResearchView() {
  const navigate = useNavigate();
  const ask = useAskResearch();
  const lawsSearch = useLawsSearch();
  const signPdf = useSignedPdfUrl();
  const showToast = useUIStore((s) => s.showToast);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'corpus' ? 'corpus' : 'ask');
  const [query, setQuery] = useState<string>(searchParams.get('q') ?? '');
  const [followUp, setFollowUp] = useState<string>('');

  // Jurisdiction filter — initialise from URL so deep links / shared
  // search URLs preserve the scope. 'all' is the default, no URL param.
  const initialScope = ((): { kind: ScopeKind; state?: string } => {
    const raw = searchParams.get('scope') ?? '';
    if (raw === 'central') return { kind: 'central' };
    if (raw === 'state') return { kind: 'state' };
    if (raw.startsWith('state:')) return { kind: 'state', state: raw.slice('state:'.length) };
    return { kind: 'all' };
  })();
  const [scopeKind, setScopeKind] = useState<ScopeKind>(initialScope.kind);
  const [scopeState, setScopeState] = useState<string>(initialScope.state ?? '');

  /** Build the wire-shape scope string the API expects. */
  function buildScope(): string | undefined {
    if (scopeKind === 'all') return undefined;
    if (scopeKind === 'central') return 'central';
    return scopeState ? `state:${scopeState}` : 'state';
  }

  function runCorpusSearch(q: string): void {
    lawsSearch.mutate({ query: q, rerank: true, scope: buildScope() });
  }

  // When Cmd+K (or another deep link) lands here with ?q= + ?mode=corpus,
  // auto-run the search so the user doesn't have to hit Enter again.
  useEffect(() => {
    const q = searchParams.get('q');
    const m = searchParams.get('mode');
    if (q && m === 'corpus' && !lawsSearch.data && !lawsSearch.isPending) {
      lawsSearch.mutate({ query: q, rerank: true, scope: buildScope() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run the search whenever the user changes the jurisdiction filter
  // (but only in corpus mode, and only when there's already an active
  // query — we don't want to fire an empty search on first mount).
  useEffect(() => {
    if (mode !== 'corpus') return;
    const q = query.trim();
    if (!q || !lawsSearch.data) return;
    lawsSearch.mutate({ query: q, rerank: true, scope: buildScope() });
    // Mirror to URL so the scope survives reloads / sharing.
    const np = new URLSearchParams(searchParams);
    const s = buildScope();
    if (s) np.set('scope', s);
    else np.delete('scope');
    setSearchParams(np, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind, scopeState]);

  const switchMode = (next: Mode) => {
    setMode(next);
    const np = new URLSearchParams(searchParams);
    if (next === 'corpus') np.set('mode', 'corpus');
    else np.delete('mode');
    setSearchParams(np, { replace: true });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (mode === 'ask') {
      ask.mutate(q);
    } else {
      runCorpusSearch(q);
    }
  };

  const runSuggestion = (s: string) => {
    setQuery(s);
    if (mode === 'ask') ask.mutate(s);
    else runCorpusSearch(s);
  };

  const sendFollowUp = () => {
    const q = followUp.trim();
    if (!q) return;
    setQuery(q);
    setFollowUp('');
    ask.mutate(q);
  };

  const openPdf = async (storagePath: string | null, sourceUrl: string | null) => {
    if (storagePath) {
      const url = await signPdf(storagePath).catch(() => null);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    if (sourceUrl) {
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    showToast({ type: 'cobalt', text: 'No source PDF available for this section.' });
  };

  const copyCitation = async (hit: LawHit) => {
    const caveat = hit.verified === false
      ? '\n\n[NEEDS REVIEW — parsed from the official gazette text, not yet checked by counsel against the primary source. Verify before citing in a filing.]'
      : '';
    const text = (hit.citation
      ? `${hit.citation}\n\n${hit.content}`
      : `${hit.actTitle ?? 'Indian law'}, section ${hit.sectionNumber ?? '?'}\n\n${hit.content}`) + caveat;
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'sage', text: 'Citation copied' });
    } catch {
      showToast({ type: 'cobalt', text: 'Could not access clipboard' });
    }
  };

  const insertInDraft = (hit: LawHit) => {
    const base = hit.citation ?? `${hit.actTitle ?? ''} ${hit.sectionNumber ?? ''}`.trim();
    navigate('/app/draft', {
      state: {
        researchCitation: {
          query,
          answer: hit.content,
          // Carry the verification caveat INTO the draft text itself, not
          // just the search-results screen — this is what ends up in
          // "Authority: ..." inside the drafted document, the highest-
          // stakes place for an unverified parse to silently look final.
          citationText: hit.verified === false ? `${base} [NEEDS REVIEW — not yet counsel-verified]` : base,
        },
      },
    });
  };

  return (
    <div className="col stagger ai-research" style={{ gap: 24 }}>
      <PageHeader
        title="Legal Research"
        description={
          mode === 'ask'
            ? 'Ask Lex.AI a legal question; answers cite Indian statutes and judgments.'
            : lawsSearch.data?.source === 'local-bns'
              ? 'Search BNS, 2023 gazette text (not yet counsel-verified). Other acts aren’t indexed yet.'
              : 'Search indexed Indian statutes and cases, with citations and source PDFs.'
        }
      />

      {/* Mode switcher */}
      <div className="ai-seg" role="tablist" aria-label="Research mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ask'}
          onClick={() => switchMode('ask')}
          className={mode === 'ask' ? 'active' : ''}
        >
          <Icon name="chat" size={14} /> Ask Lex.AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'corpus'}
          onClick={() => switchMode('corpus')}
          className={mode === 'corpus' ? 'active' : ''}
        >
          <Icon name="search" size={14} /> Search statutes
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="ai-ask"
      >
        <textarea
            className="ai-ask-input"
            rows={3}
            aria-label={mode === 'ask' ? 'Your legal question' : 'Search the statute corpus'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'ask'
                ? 'e.g. What is the limitation period for filing a winding-up petition under the Companies Act, 2013?'
                : 'e.g. cheating dishonest inducement, or IPC 420, or limitation period winding up'
            }
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
        <div className="ai-ask-bar">
          <span className="ai-ask-hint">
            <Icon name={mode === 'ask' ? 'sparkle' : 'search'} size={13} />
            {mode === 'ask' ? 'Answers cite Indian statutes and judgments' : 'Hybrid search across indexed Acts'}
          </span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              (mode === 'ask' ? ask.isPending : lawsSearch.isPending)
              || query.trim().length === 0
            }
          >
            {mode === 'ask'
              ? (ask.isPending ? 'Researching…' : 'Ask Lex.AI')
              : (lawsSearch.isPending ? 'Searching…' : 'Search corpus')}
          </button>
        </div>
      </form>

      {SUGGESTIONS.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="eyebrow" style={{ alignSelf: 'center', marginRight: 4 }}>Try</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => runSuggestion(s)}
              disabled={ask.isPending}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Jurisdiction filter — corpus mode only. */}
      {mode === 'corpus' && (
        <div className="row ai-research-scope" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="ai-eyebrow" style={{ alignSelf: 'center', marginRight: 4 }}>Scope</span>
          <button
            type="button"
            className={`chip ${scopeKind === 'all' ? 'active' : ''}`}
            aria-pressed={scopeKind === 'all'}
            onClick={() => { setScopeKind('all'); setScopeState(''); }}
          >
            All
          </button>
          <button
            type="button"
            className={`chip ${scopeKind === 'central' ? 'active' : ''}`}
            aria-pressed={scopeKind === 'central'}
            onClick={() => { setScopeKind('central'); setScopeState(''); }}
          >
            Central only
          </button>
          <button
            type="button"
            className={`chip ${scopeKind === 'state' ? 'active' : ''}`}
            aria-pressed={scopeKind === 'state'}
            onClick={() => setScopeKind('state')}
          >
            State{scopeState ? ` · ${scopeState}` : ''}
          </button>
          {scopeKind === 'state' && (
            <select
              className="input"
              value={scopeState}
              onChange={(e) => setScopeState(e.target.value)}
              style={{ height: 34, minHeight: 34, fontSize: 13, padding: '0 12px', width: 'auto', minWidth: 180, maxWidth: '100%' }}
              aria-label="Filter by specific state"
            >
              <option value="">All states</option>
              {CANONICAL_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {!lawsSearch.data && (
            <span className="body-xs muted">Run a search to apply this filter</span>
          )}
        </div>
      )}

      {mode === 'ask' && ask.isPending && (
        <div className="ai-panel" aria-busy="true">
          <div className="ai-eyebrow">Lex.AI</div>
          <p className="body-md muted" style={{ margin: 0 }}>
            Researching<span className="blink" />
          </p>
          <div className="col" style={{ gap: 10, marginTop: 16 }}>
            <Skeleton height={12} width="92%" />
            <Skeleton height={12} width="78%" />
            <Skeleton height={12} width="85%" />
          </div>
        </div>
      )}

      {mode === 'ask' && ask.isError && (
        (ask.error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code === 'RESEARCH_NOT_IMPLEMENTED' ? (
          <ErrorState
            title="Ask Lex.AI isn't configured on this deployment"
            description="This feature needs a research backend to be set up by an administrator. Retrying won't help — try Search statutes instead."
          />
        ) : (
          <ErrorState title="Couldn't reach Lex.AI" description="Try again in a moment." />
        )
      )}

      {mode === 'corpus' && lawsSearch.isPending && (
        <div className="col" style={{ gap: 12 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card" aria-busy="true">
              <Skeleton height={14} width="55%" />
              <div style={{ height: 8 }} />
              <Skeleton height={12} width="100%" />
              <div style={{ height: 4 }} />
              <Skeleton height={12} width="86%" />
            </div>
          ))}
        </div>
      )}

      {mode === 'corpus' && lawsSearch.isError && (
        <ErrorState
          icon="research"
          title="Couldn't search the corpus"
          description={
            (lawsSearch.error as Error | null)?.message ?? 'Check that the laws backend is configured and reachable.'
          }
        />
      )}

      {mode === 'corpus' && lawsSearch.data && !lawsSearch.isPending && (
        <>
          {lawsSearch.data.results.length === 0 ? (
            <EmptyState
              icon="research"
              title="No matches"
              description={
                scopeKind !== 'all'
                  ? `No matches in this jurisdiction. Try widening the scope${scopeState ? ` (currently ${scopeState})` : ''} or rephrasing.`
                  : "Try a broader phrasing, drop quotes, or use a specific section number like 'BNS 103'."
              }
            />
          ) : (
            <div className="col" style={{ gap: 12 }}>
              <div className="ai-section-head">
                <h2 className="ai-section-title ai-section-title--sm">
                  {lawsSearch.data.results.length} matching section{lawsSearch.data.results.length === 1 ? '' : 's'}
                </h2>
              </div>
              {lawsSearch.data.results.map((hit) => (
                <article key={hit.id} className="ai-hit">
                  <div className="ai-hit-head">
                    <span className="ai-hit-cite">
                      {hit.citation
                        ?? `${hit.actTitle ?? 'Section'}${hit.sectionNumber ? `, § ${hit.sectionNumber}` : ''}`}
                    </span>
                    {hit.sectionHeading && (
                      <>
                        <span className="ai-hit-heading">
                          {hit.sectionHeading}
                        </span>
                      </>
                    )}
                    <JurisdictionBadge jurisdiction={hit.jurisdiction} state={hit.state} />
                    <VerificationBadge verified={hit.verified} />
                    <span className="spacer" />
                    <span className="ai-hit-score" title="Reciprocal-rank-fusion score">
                      {(hit.rerankScore ?? hit.score).toFixed(3)}
                    </span>
                  </div>
                  {hit.oldSection && (
                    <p className="ai-hit-replaces">
                      Replaces {hit.oldSection}
                    </p>
                  )}
                  <p className="ai-hit-text">
                    {hit.content}
                  </p>
                  <div className="ai-hit-actions">
                    <button type="button" className="btn btn-sm" onClick={() => copyCitation(hit)}>
                      <Icon name="documents" size={12} /> Copy citation
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => insertInDraft(hit)}>
                      <Icon name="draft" size={12} /> Use in draft
                    </button>
                    {(hit.pdfStoragePath || hit.sourceUrl) && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openPdf(hit.pdfStoragePath, hit.sourceUrl)}
                      >
                        <Icon name="file" size={12} /> Open PDF
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'ask' && ask.data && !ask.isPending && (
        <>
          <article className="ai-panel ai-answer">
            <div className="row" style={{ gap: 10 }}>
              <span className="ai-answer-mark" aria-hidden><Icon name="sparkle" size={14} /></span>
              <span className="ai-eyebrow">Lex.AI</span>
              <span className="spacer" />
              <span className="ai-field-meta">
                {ask.data.citations.length} citation{ask.data.citations.length === 1 ? '' : 's'}
              </span>
            </div>
            {ask.data.query && <h2 className="ai-answer-q">{ask.data.query}</h2>}
            <p className="ai-answer-text">{ask.data.answer}</p>
            <div className="ai-hit-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (!ask.data) return;
                  const text = formatBrief(ask.data.query, ask.data.answer, ask.data.citations);
                  try {
                    await navigator.clipboard.writeText(text);
                    showToast({ type: 'sage', text: 'Brief copied to clipboard' });
                  } catch {
                    showToast({ type: 'cobalt', text: 'Could not access clipboard' });
                  }
                }}
              >
                Save to brief
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (!ask.data) return;
                  const citationText = ask.data.citations
                    .map((c) => `${c.title} (${c.court}, ${c.citation})`)
                    .join('; ');
                  navigate('/app/draft', {
                    state: {
                      researchCitation: {
                        query: ask.data.query,
                        answer: ask.data.answer,
                        citationText,
                      },
                    },
                  });
                  showToast({ type: 'sage', text: 'Opening draft with research context' });
                }}
              >
                Cite in draft
              </button>
            </div>
          </article>

          {ask.data.citations.length > 0 && (
            <section className="col" style={{ gap: 12 }}>
              <h2 className="ai-section-title ai-section-title--sm">Authorities</h2>
              <ol className="ai-list ai-authorities">
                {ask.data.citations.map((c, i) => (
                  <li key={`${c.citation}-${i}`} className="ai-authority">
                    <span className="ai-authority-n">{String(i + 1).padStart(2, '0')}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="ai-authority-title">{c.title}</div>
                      <div className="ai-authority-meta">
                        <span>{c.court}</span>
                        <span aria-hidden>·</span>
                        <strong>{c.citation}</strong>
                      </div>
                      {c.excerpt && <p className="ai-authority-excerpt">{c.excerpt}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="ai-panel ai-followup">
            <label className="field-label" htmlFor="followup-input">Ask a follow-up</label>
            <div className="ai-composer-row" style={{ marginTop: 0 }}>
              <input
                id="followup-input"
                className="input"
                style={{ flex: 1 }}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    sendFollowUp();
                  }
                }}
                placeholder="Refine the question or pull a tangent…"
              />
              <button
                type="button"
                className="btn"
                onClick={sendFollowUp}
                disabled={ask.isPending || followUp.trim().length === 0}
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
