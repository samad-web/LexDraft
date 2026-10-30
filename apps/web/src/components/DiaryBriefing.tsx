import { Icon } from '@lexdraft/ui';
import type { DiaryBriefing as DiaryBriefingT, DiaryBriefingItemKind } from '@lexdraft/types';
import { useBriefing } from '@/hooks/useDiaryAssistant';

interface Props {
  range: 'today' | 'week';
  onRangeChange: (r: 'today' | 'week') => void;
  /** Lazily loaded so opening the Diary doesn't spend AI quota. */
  loaded: boolean;
  onLoad: () => void;
}

const KIND_META: Record<DiaryBriefingItemKind, { label: string; badge: string }> = {
  hearing: { label: 'Hearing', badge: 'badge-cobalt' },
  judgment: { label: 'Judgment', badge: 'badge-sage' },
  filing: { label: 'Filing', badge: 'badge-amber' },
  limitation: { label: 'Limitation', badge: 'badge-vermillion' },
};

function daysLabel(d: number): string {
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'due today';
  return `${d}d left`;
}

function summaryFromCounts(c: DiaryBriefingT['counts']): string {
  const parts: string[] = [];
  if (c.hearings) parts.push(`${c.hearings} hearing${c.hearings > 1 ? 's' : ''}`);
  if (c.judgments) parts.push(`${c.judgments} judgment${c.judgments > 1 ? 's' : ''}`);
  if (c.filings) parts.push(`${c.filings} filing${c.filings > 1 ? 's' : ''}`);
  if (c.limitations) parts.push(`${c.limitations} limitation${c.limitations > 1 ? 's' : ''} due`);
  return parts.length ? parts.join(' · ') : 'Nothing scheduled.';
}

export function DiaryBriefing({ range, onRangeChange, loaded, onLoad }: Props) {
  const q = useBriefing(range, loaded);

  return (
    <div className="card ct-brief">
      <div className="ct-brief-head">
        <span className="ct-icon-tile" aria-hidden><Icon name="bell" size={15} /></span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="ct-eyebrow">Assistant</span>
          <h2 className="ct-card-title" style={{ fontSize: 19 }}>Briefing</h2>
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="ct-seg" role="tablist" aria-label="Briefing range">
          {(['today', 'week'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => onRangeChange(r)}
            >
              {r === 'today' ? 'Today' : 'This week'}
            </button>
          ))}
        </div>
        {loaded && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => q.refetch()} disabled={q.isFetching} title="Refresh briefing">
            <Icon name="arrow" size={13} /> Refresh
          </button>
        )}
      </div>

      {!loaded && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="ct-meta" style={{ flex: '1 1 260px' }}>
            See your {range === 'week' ? 'week' : 'day'} at a glance: hearings, judgments, filings and limitation deadlines, with an AI summary.
          </span>
          <button type="button" className="btn btn-sm" onClick={onLoad}>
            <Icon name="bell" size={13} /> Show briefing
          </button>
        </div>
      )}

      {loaded && q.isLoading && (
        <div className="col" style={{ gap: 8 }} aria-busy="true">
          <span className="ct-skel" style={{ width: '82%', height: 16 }} />
          <span className="ct-skel" style={{ width: '60%', height: 16 }} />
          <span className="ct-meta">Preparing your briefing<span className="blink" /></span>
        </div>
      )}

      {loaded && q.isError && (
        <p className="ct-notice is-danger" style={{ margin: 0, alignItems: 'center' }}>
          Couldn’t build the briefing. <button type="button" className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Retry</button>
        </p>
      )}

      {loaded && q.data && (
        <>
          <p className="ct-brief-narr">
            {q.data.narrative || summaryFromCounts(q.data.counts)}
          </p>

          <div className="ct-brief-counts">
            {(['hearings', 'judgments', 'filings', 'limitations'] as const).map((k) => {
              const meta = KIND_META[k === 'hearings' ? 'hearing' : k === 'judgments' ? 'judgment' : k === 'filings' ? 'filing' : 'limitation'];
              const n = q.data!.counts[k];
              return (
                <span key={k} className={`ct-pill${n ? (k === 'limitations' ? ' is-ink' : ' is-strong') : ' is-quiet'}`}>
                  {n} {meta.label}{n === 1 ? '' : 's'}
                </span>
              );
            })}
          </div>

          {q.data.items.length > 0 && (
            <div className="ct-brief-list">
              {q.data.items.slice(0, 12).map((it, idx) => {
                const meta = KIND_META[it.kind];
                const urgent = it.daysRemaining !== null && it.daysRemaining <= 2;
                return (
                  <div key={`${it.kind}-${it.date}-${it.time}-${idx}`} className="ct-brief-item">
                    <span className="ct-brief-when">
                      {it.date.slice(5)}{it.time ? ` ${it.time}` : ''}
                    </span>
                    <span><span className={`ct-pill${it.kind === 'limitation' ? ' is-strong' : ''}`}>{meta.label}</span></span>
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="ct-title" style={{ fontSize: 14 }}>{it.title || '(unnamed matter)'}</span>
                      {(it.detail || it.forum) && (
                        <span className="ct-meta">
                          {it.detail}{it.detail && it.forum ? <span className="ct-meta-dot" /> : null}{it.forum}
                        </span>
                      )}
                    </span>
                    {it.daysRemaining !== null ? (
                      <span className={`ct-pill${urgent ? ' is-ink' : ''}`}>{daysLabel(it.daysRemaining)}</span>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          )}

          {q.data.items.length > 0 && q.data.modelUsed.startsWith('fallback') && q.data.narrative === '' && (
            <span className="body-xs muted">AI summary unavailable, showing your schedule from the record.</span>
          )}
        </>
      )}
    </div>
  );
}
