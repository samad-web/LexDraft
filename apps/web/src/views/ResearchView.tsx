import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useAskResearch } from '@/hooks/useResearch';
import { useLawsSearch, useSignedPdfUrl, type LawHit } from '@/hooks/useLawsSearch';
import { JurisdictionBadge } from '@/components/JurisdictionBadge';
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

  // When Cmd+K (or another deep link) lands here with ?q= + ?mode=corpus,
  // auto-run the search so the user doesn't have to hit Enter again.
  useEffect(() => {
    const q = searchParams.get('q');
    const m = searchParams.get('mode');
    if (q && m === 'corpus' && !lawsSearch.data && !lawsSearch.isPending) {
      lawsSearch.mutate({ query: q, rerank: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      lawsSearch.mutate({ query: q, rerank: true });
    }
  };

  const runSuggestion = (s: string) => {
    setQuery(s);
    if (mode === 'ask') ask.mutate(s);
    else lawsSearch.mutate({ query: s, rerank: true });
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
    const text = hit.citation
      ? `${hit.citation}\n\n${hit.content}`
      : `${hit.actTitle ?? 'Indian law'}, section ${hit.sectionNumber ?? '?'}\n\n${hit.content}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'sage', text: 'Citation copied' });
    } catch {
      showToast({ type: 'cobalt', text: 'Could not access clipboard' });
    }
  };

  const insertInDraft = (hit: LawHit) => {
    navigate('/app/draft', {
      state: {
        researchCitation: {
          query,
          answer: hit.content,
          citationText: hit.citation ?? `${hit.actTitle ?? ''} ${hit.sectionNumber ?? ''}`.trim(),
        },
      },
    });
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Research</div>
        <h1 className="heading-xl">
          {mode === 'ask' ? 'Ask Lex.AI a legal question' : 'Search Indian statutes & cases'}
        </h1>
        <p className="lede" style={{ maxWidth: '60ch', marginTop: 8 }}>
          {mode === 'ask'
            ? 'Synthesised answers from Indian statutes, Supreme Court & High Court judgments, with traceable citations.'
            : 'Direct hybrid search (vector + keyword) over the indexed corpus. Returns matching sections with citations and source PDFs.'}
        </p>
      </div>

      {/* Mode switcher */}
      <div className="row" role="tablist" style={{ gap: 4 }}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ask'}
          onClick={() => switchMode('ask')}
          className={`btn ${mode === 'ask' ? 'btn-primary' : ''}`}
        >
          <Icon name="chat" size={14} /> Ask Lex.AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'corpus'}
          onClick={() => switchMode('corpus')}
          className={`btn ${mode === 'corpus' ? 'btn-primary' : ''}`}
        >
          <Icon name="search" size={14} /> Search statutes
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="card"
        style={{
          background: 'var(--bg-surface-2)',
          padding: 'var(--space-5)',
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--text-tertiary)', display: 'flex', paddingTop: 10 }}>
            <Icon name="research" size={18} />
          </div>
          <textarea
            className="input"
            rows={2}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'ask'
                ? 'e.g. What is the limitation period for filing a winding-up petition under the Companies Act, 2013?'
                : 'e.g. cheating dishonest inducement, or IPC 420, or limitation period winding up'
            }
            style={{ flex: 1, resize: 'vertical', height: 'auto', fontSize: 16, lineHeight: 1.5 }}
          />
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

      {mode === 'ask' && ask.isPending && (
        <div className="card" aria-busy="true">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Lex.AI</div>
          <p className="body-md muted">
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
        <ErrorState title="Couldn't reach Lex.AI" description="Try again in a moment." />
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
              description="Try a broader phrasing, drop quotes, or use a specific section number like 'BNS 103'."
            />
          ) : (
            <div className="col" style={{ gap: 12 }}>
              <div className="row">
                <span className="eyebrow">
                  {lawsSearch.data.results.length} matching section{lawsSearch.data.results.length === 1 ? '' : 's'}
                </span>
                <span className="spacer" />
              </div>
              {lawsSearch.data.results.map((hit) => (
                <article key={hit.id} className="card card-hover">
                  <div className="row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono body-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {hit.citation
                        ?? `${hit.actTitle ?? 'Section'}${hit.sectionNumber ? `, § ${hit.sectionNumber}` : ''}`}
                    </span>
                    {hit.sectionHeading && (
                      <>
                        <span className="muted">·</span>
                        <span className="body-sm" style={{ fontStyle: 'italic' }}>
                          {hit.sectionHeading}
                        </span>
                      </>
                    )}
                    <JurisdictionBadge jurisdiction={hit.jurisdiction} state={hit.state} />
                    <span className="spacer" />
                    <span className="mono body-xs muted" title="Reciprocal-rank-fusion score">
                      {(hit.rerankScore ?? hit.score).toFixed(3)}
                    </span>
                  </div>
                  <p className="body-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                    {hit.content.length > 600 ? `${hit.content.slice(0, 600)}…` : hit.content}
                  </p>
                  <div className="row rule-top" style={{ gap: 8, marginTop: 14, paddingTop: 12 }}>
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
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="eyebrow">Lex.AI</span>
              <span className="spacer" />
              <span className="mono body-xs muted">
                {ask.data.citations.length} citation{ask.data.citations.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="body-lg" style={{ whiteSpace: 'pre-wrap' }}>{ask.data.answer}</p>
            <div className="row rule-top" style={{ gap: 8, marginTop: 20, paddingTop: 16 }}>
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
          </div>

          {ask.data.citations.length > 0 && (
            <div className="col" style={{ gap: 12 }}>
              <div className="eyebrow">Authorities</div>
              {ask.data.citations.map((c, i) => (
                <div key={`${c.citation}-${i}`} className="card card-hover">
                  <div className="row" style={{ marginBottom: 8 }}>
                    <em className="case-name body-md" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                      {c.title}
                    </em>
                  </div>
                  <div className="row" style={{ gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span className="mono body-sm muted">{c.court}</span>
                    <span className="muted">·</span>
                    <span className="mono body-sm" style={{ color: 'var(--text-primary)' }}>{c.citation}</span>
                  </div>
                  <p className="body-sm muted">{c.excerpt}</p>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ background: 'var(--bg-surface-2)' }}>
            <label className="label" htmlFor="followup-input">Ask a follow-up</label>
            <div className="row" style={{ gap: 10 }}>
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
