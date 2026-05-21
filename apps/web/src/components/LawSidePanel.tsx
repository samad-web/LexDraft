import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Skeleton } from '@lexdraft/ui';
import { useLawsSearchSuggestions, useSignedPdfUrl, type LawHit } from '@/hooks/useLawsSearch';
import { useUIStore } from '@/store/ui';
import { JurisdictionBadge } from '@/components/JurisdictionBadge';

interface Props {
  /**
   * Live text the panel should search against — typically the current
   * paragraph the user is editing, the clause under review, or the case
   * description. The panel debounces internally; callers can feed it
   * directly from a setState.
   */
  context: string;
  /**
   * Title shown at the top of the panel. Defaults to "Related law" but
   * Drafting / Contract review may want their own framing
   * ("Authorities on this clause").
   */
  title?: string;
  /** Number of results. 5–8 is the sweet spot for a side panel. */
  k?: number;
  /** Override the debounce window. Default 600ms. */
  debounceMs?: number;
}

function useDebouncedValue(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Live recommendations from the indiacode-rag corpus. Mount anywhere with
 * dynamic legal context — drafting view, contract review, case detail.
 *
 * Internals:
 *   - Debounces `context` so a fast-typing user doesn't fire one request
 *     per keystroke. The hook's react-query staleTime + the API's in-memory
 *     cache catch the rest.
 *   - Trims to the last few sentences (max ~800 chars) since the embed
 *     service truncates at 1024 tokens and short, focused context yields
 *     more relevant matches than a whole document.
 *   - Lets the user override with a manual query box at the top.
 */
export function LawSidePanel({ context, title = 'Related law', k = 6, debounceMs = 600 }: Props) {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const signPdf = useSignedPdfUrl();

  const [manualQuery, setManualQuery] = useState('');
  // When the user types into the manual box it OVERRIDES the live context.
  const liveContext = useMemo(() => {
    const trimmed = context.trim();
    if (!trimmed) return '';
    // Focus on the trailing window — that's what the user just wrote.
    return trimmed.length > 800 ? trimmed.slice(-800) : trimmed;
  }, [context]);

  const effective = manualQuery.trim() || liveContext;
  const debounced = useDebouncedValue(effective, debounceMs);

  const q = useLawsSearchSuggestions(debounced, { k, rerank: false });

  const openPdf = async (hit: LawHit) => {
    if (hit.pdfStoragePath) {
      const url = await signPdf(hit.pdfStoragePath).catch(() => null);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    if (hit.sourceUrl) window.open(hit.sourceUrl, '_blank', 'noopener,noreferrer');
  };

  const copyCitation = async (hit: LawHit) => {
    const text = hit.citation ?? `${hit.actTitle ?? ''} § ${hit.sectionNumber ?? ''}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'sage', text: 'Citation copied' });
    } catch {
      /* silent */
    }
  };

  return (
    <aside
      aria-label={title}
      style={{
        position: 'sticky',
        top: 'var(--space-6, 24px)',
        width: '100%',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5, 20px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxHeight: 'calc(100vh - 120px)',
        overflow: 'auto',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <Icon name="research" size={14} />
        <div className="eyebrow">{title}</div>
        <span className="spacer" />
        {q.isFetching && (
          <span className="mono body-xs muted" aria-live="polite">…</span>
        )}
      </div>

      <input
        type="search"
        className="input"
        placeholder="Search this corpus…"
        value={manualQuery}
        onChange={(e) => setManualQuery(e.target.value)}
        style={{ fontSize: 13, height: 36 }}
        aria-label="Override the live context with a manual query"
      />

      {!debounced && (
        <p className="body-xs muted" style={{ padding: '8px 4px', lineHeight: 1.5 }}>
          {manualQuery.trim()
            ? 'Type at least 3 characters.'
            : 'Recommendations will appear as you write. Or use the box above to search directly.'}
        </p>
      )}

      {q.isLoading && debounced && (
        <div className="col" style={{ gap: 8 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} aria-busy="true" style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <Skeleton height={12} width="50%" />
              <div style={{ height: 6 }} />
              <Skeleton height={10} width="100%" />
              <div style={{ height: 4 }} />
              <Skeleton height={10} width="80%" />
            </div>
          ))}
        </div>
      )}

      {q.isError && (
        <p className="body-xs" style={{ color: 'var(--danger)', padding: '8px 4px' }}>
          Couldn&rsquo;t reach the law corpus.
        </p>
      )}

      {q.data && q.data.results.length === 0 && debounced && !q.isLoading && (
        <p className="body-xs muted" style={{ padding: '8px 4px' }}>
          No matches for the current context. Try a manual query above.
        </p>
      )}

      {q.data && q.data.results.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          {q.data.results.map((hit) => (
            <article
              key={hit.id}
              style={{
                padding: 10,
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface-2)',
              }}
            >
              <div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className="mono body-xs" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {hit.citation ?? `${hit.actTitle ?? 'Law'}${hit.sectionNumber ? ` § ${hit.sectionNumber}` : ''}`}
                </span>
                <JurisdictionBadge jurisdiction={hit.jurisdiction} state={hit.state} compact />
              </div>
              {hit.sectionHeading && (
                <div className="body-xs" style={{ marginBottom: 4, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                  {hit.sectionHeading}
                </div>
              )}
              <p className="body-xs muted" style={{ lineHeight: 1.5, marginBottom: 8 }}>
                {hit.content}
              </p>
              <div className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
                  onClick={() => copyCitation(hit)}
                  title="Copy citation"
                >
                  Cite
                </button>
                {(hit.pdfStoragePath || hit.sourceUrl) && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
                    onClick={() => openPdf(hit)}
                    title="Open source PDF"
                  >
                    PDF
                  </button>
                )}
              </div>
            </article>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-block"
            style={{ marginTop: 4, fontSize: 12 }}
            onClick={() =>
              navigate(`/app/research?mode=corpus&q=${encodeURIComponent(debounced)}`)
            }
          >
            Open full search →
          </button>
        </div>
      )}
    </aside>
  );
}
