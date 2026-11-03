// =============================================================================
// ComposeStatusNotice — how the engine draft's body was written, in the rail.
//
// Reads the optional IntakeDraft fields the API fills:
//   composeStatus 'skeleton' -> a calm notice with composeNotice: the body is
//     the engine's plain draft because full drafting failed a check. Not an
//     error and not red — the draft is usable, it just needs more writing.
//   addedAuthorities -> "Authorities added — check before filing": provisions /
//     judgments the drafted body cites beyond the engine skeleton, linked when
//     the API gives a url.
// Renders nothing when neither applies.
// =============================================================================

import type { IntakeDraft } from '@lexdraft/types';
import '@/styles/chambers/draft-tools.css';

const SOURCE_LABEL: Record<NonNullable<IntakeDraft['addedAuthorities']>[number]['source'], string> = {
  curated: 'curated',
  'statute-db': 'statute',
  judgment: 'judgment',
};

/** Only http(s) links are rendered as links. */
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : null);

export function ComposeStatusNotice({
  draft,
  label,
  bare = false,
  show = 'all',
}: {
  draft: Pick<IntakeDraft, 'composeStatus' | 'composeNotice' | 'addedAuthorities'> | null | undefined;
  /** Document name, when more than one document is shown (e.g. a companion affidavit). */
  label?: string;
  /** Render without the rail card wrapper (inside another surface). */
  bare?: boolean;
  /** Which part to show: the skeleton notice, the authorities list, or both. */
  show?: 'all' | 'notice' | 'authorities';
}) {
  if (!draft) return null;
  const skeleton = show !== 'authorities' && draft.composeStatus === 'skeleton';
  const authorities = show === 'notice' ? [] : draft.addedAuthorities ?? [];
  if (!skeleton && authorities.length === 0) return null;

  const body = (
    <>
      {skeleton && (
        <p className="dt-notice" role="status">
          {draft.composeNotice?.trim() || 'This is the plain court draft. The full drafted body could not be written from the facts on record, so some paragraphs need your words.'}
        </p>
      )}
      {authorities.length > 0 && (
        <div className="dw-group">
          <div className="dw-group-title">Authorities added — check before filing · {authorities.length}</div>
          <ul className="dw-items dt-auth">
            {authorities.map((a) => {
              const url = safeUrl(a.url);
              return (
                <li key={`${a.source}:${a.cite}`}>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer">{a.cite}</a> : a.cite}
                  <span className="dt-auth-src">{SOURCE_LABEL[a.source] ?? a.source}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  if (bare) return body;
  return (
    <section className="dc-card">
      <div className="dc-eyebrow">{label ? `Authorities · ${label}` : 'Authorities'}</div>
      {body}
    </section>
  );
}
