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
    <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}>
          <Icon name="bell" size={16} />
        </span>
        <div className="heading-md">Briefing</div>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="row" style={{ gap: 6 }}>
          {(['today', 'week'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${range === r ? 'active' : ''}`}
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
          <span className="body-sm muted">
            See your {range === 'week' ? 'week' : 'day'} at a glance — hearings, judgments, filings and limitation deadlines, with an AI summary.
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={onLoad}>
            <Icon name="bell" size={13} /> Show briefing
          </button>
        </div>
      )}

      {loaded && q.isLoading && (
        <p className="body-md muted">Preparing your briefing<span className="blink" /></p>
      )}

      {loaded && q.isError && (
        <p className="body-sm" style={{ color: 'var(--danger)' }}>
          Couldn’t build the briefing. <button type="button" className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Retry</button>
        </p>
      )}

      {loaded && q.data && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(['hearings', 'judgments', 'filings', 'limitations'] as const).map((k) => {
              const meta = KIND_META[k === 'hearings' ? 'hearing' : k === 'judgments' ? 'judgment' : k === 'filings' ? 'filing' : 'limitation'];
              const n = q.data!.counts[k];
              return (
                <span key={k} className={`badge ${meta.badge}`} style={{ opacity: n ? 1 : 0.45 }}>
                  {n} {meta.label}{n === 1 ? '' : 's'}
                </span>
              );
            })}
          </div>

          <p className="body-md" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0 }}>
            {q.data.narrative || summaryFromCounts(q.data.counts)}
          </p>

          {q.data.items.length > 0 && (
            <div className="col" style={{ gap: 8 }}>
              {q.data.items.slice(0, 12).map((it, idx) => {
                const meta = KIND_META[it.kind];
                const urgent = it.daysRemaining !== null && it.daysRemaining <= 2;
                return (
                  <div
                    key={`${it.kind}-${it.date}-${it.time}-${idx}`}
                    className="row"
                    style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <span className="mono body-xs tabular" style={{ width: 88, color: 'var(--text-secondary)' }}>
                      {it.date.slice(5)}{it.time ? ` ${it.time}` : ''}
                    </span>
                    <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    <span className="body-sm" style={{ fontWeight: 500 }}>{it.title || '(unnamed matter)'}</span>
                    {it.detail && <span className="body-sm muted">· {it.detail}</span>}
                    {it.forum && <span className="body-xs muted">· {it.forum}</span>}
                    {it.daysRemaining !== null && (
                      <span
                        className="body-xs mono"
                        style={{ color: urgent ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: 600 }}
                      >
                        {daysLabel(it.daysRemaining)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {q.data.items.length > 0 && q.data.modelUsed.startsWith('fallback') && q.data.narrative === '' && (
            <span className="body-xs muted">AI summary unavailable — showing your schedule from the record.</span>
          )}
        </>
      )}
    </div>
  );
}
