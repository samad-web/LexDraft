import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useAskResearch } from '@/hooks/useResearch';
import { useUIStore } from '@/store/ui';

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
  const showToast = useUIStore((s) => s.showToast);
  const [query, setQuery] = useState<string>('');
  const [followUp, setFollowUp] = useState<string>('');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    ask.mutate(q);
  };

  const runSuggestion = (s: string) => {
    setQuery(s);
    ask.mutate(s);
  };

  const sendFollowUp = () => {
    const q = followUp.trim();
    if (!q) return;
    setQuery(q);
    setFollowUp('');
    ask.mutate(q);
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Research</div>
        <h1 className="heading-xl">Ask Lex.AI a legal question</h1>
        <p className="lede" style={{ maxWidth: '60ch', marginTop: 8 }}>
          Synthesised answers from Indian statutes, Supreme Court &amp; High Court judgments, with
          traceable citations.
        </p>
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
            placeholder="e.g. What is the limitation period for filing a winding-up petition under the Companies Act, 2013?"
            style={{ flex: 1, resize: 'vertical', height: 'auto', fontSize: 16, lineHeight: 1.5 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={ask.isPending || query.trim().length === 0}
          >
            {ask.isPending ? 'Researching…' : 'Ask Lex.AI'}
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

      {ask.isPending && (
        <div className="card" aria-busy="true">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Lex.AI</div>
          <p className="body-md muted">
            Researching<span className="blink" />
          </p>
          <div className="col" style={{ gap: 10, marginTop: 16 }}>
            <div style={{ height: 12, width: '92%', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)' }} />
            <div style={{ height: 12, width: '78%', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)' }} />
            <div style={{ height: 12, width: '85%', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)' }} />
          </div>
        </div>
      )}

      {ask.isError && (
        <div className="card">
          <p className="body-md" style={{ color: 'var(--danger)' }}>
            Couldn&apos;t reach Lex.AI. Please try again.
          </p>
        </div>
      )}

      {ask.data && !ask.isPending && (
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
