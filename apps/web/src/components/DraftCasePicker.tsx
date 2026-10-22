import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCases, useSyncCaseFromEcourts } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { caseToContext, type DraftCaseContext } from '@/lib/draft-case-context';

interface Props {
  selected: DraftCaseContext | null;
  onSelect: (ctx: DraftCaseContext | null) => void;
  onOpenCase?: (id: string) => void;
  /** What the engine will read from the selected matter, shown under it. */
  readSummary?: { notes: number; documents: number; unreadable: number };
}

const LIST_LIMIT = 6;

/**
 * "Matter" card in the Draft page's side rail. Attach a matter so the engine
 * drafts against its real court / CNR / parties and reads its notes and
 * papers - or leave it empty for an ad-hoc draft. "Sync eCourts" refreshes
 * the matter's record first so the particulars are current.
 */
export function DraftCasePicker({ selected, onSelect, onOpenCase, readSummary }: Props) {
  const { data: cases = [], isLoading } = useCases();
  const sync = useSyncCaseFromEcourts();
  const showToast = useUIStore((s) => s.showToast);
  const [q, setQ] = useState('');

  // Only real matters (not sandbox/quick-study) with a client-less em-dash.
  const matters = useMemo(
    () => cases.filter((c) => c.title && c.client !== '—'),
    [cases],
  );
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return matters;
    return matters.filter(
      (c) =>
        c.title.toLowerCase().includes(n) ||
        c.cnr.toLowerCase().includes(n) ||
        c.client.toLowerCase().includes(n),
    );
  }, [matters, q]);

  const onSync = async () => {
    if (!selected) return;
    try {
      await sync.mutateAsync({ id: selected.id });
      // Pull the refreshed row so the context reflects the new particulars.
      const fresh = cases.find((c) => c.id === selected.id);
      if (fresh) onSelect(caseToContext(fresh));
      showToast({ type: 'sage', text: 'Case synced from eCourts' });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'eCourts sync failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <section className="dc-card">
      <div className="dc-card-head">
        <span className="dc-card-icon"><Icon name="cases" size={16} /></span>
        <div>
          <div className="dc-eyebrow">Matter</div>
          <div className="dc-card-title">{selected ? 'Drafting for' : 'Draft for a matter'}</div>
        </div>
      </div>

      {selected ? (
        <div className="dc-matter">
          <div className="dc-matter-title">{selected.title}</div>
          <dl className="dc-matter-meta">
            <div><dt>CNR</dt><dd className="mono">{selected.cnr || 'Not set'}</dd></div>
            <div><dt>Court</dt><dd>{selected.court || 'Not set'}</dd></div>
            <div><dt>Client</dt><dd>{selected.client || 'Not set'}</dd></div>
          </dl>
          {readSummary && (
            <div className="dc-reads">
              <Icon name="sparkle" size={13} />
              <span>
                The engine reads {readSummary.notes} note{readSummary.notes === 1 ? '' : 's'} and {readSummary.documents} document
                {readSummary.documents === 1 ? '' : 's'} from this matter
                {readSummary.unreadable > 0 ? `; ${readSummary.unreadable} need${readSummary.unreadable === 1 ? 's' : ''} its file` : ''}.
              </span>
            </div>
          )}
          <div className="dc-matter-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={onSync}
              disabled={sync.isPending}
              title="Refresh this matter from eCourts before drafting"
            >
              <Icon name="ecourts" size={12} /> {sync.isPending ? 'Syncing…' : 'Sync eCourts'}
            </button>
            {onOpenCase && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpenCase(selected.id)}>
                Open
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onSelect(null)} title="Draft without a matter">
              <Icon name="close" size={12} /> Detach
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dc-card-text">
            The engine drafts against its real court, CNR and parties, and reads its notes and papers.
          </p>
          <div className="dc-search">
            <Icon name="search" size={14} />
            <input
              className="input"
              placeholder="Search title, CNR or client"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search matters"
            />
          </div>
          <ul className="dc-pick">
            {isLoading && <li className="dc-card-text">Loading matters…</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="dc-card-text">{q ? 'No matching matter.' : 'No matters yet. Open one from Cases.'}</li>
            )}
            {filtered.slice(0, LIST_LIMIT).map((c) => (
              <li key={c.id}>
                <button type="button" className="dc-pick-row" onClick={() => { onSelect(caseToContext(c)); setQ(''); }}>
                  <span className="dc-pick-avatar">{(c.title.trim()[0] ?? '·').toUpperCase()}</span>
                  <span className="dc-pick-main">
                    <span className="dc-pick-title">{c.title}</span>
                    <span className="dc-pick-sub">{c.court || 'Court not set'} · {c.client}</span>
                  </span>
                  <Icon name="plus" size={14} />
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > LIST_LIMIT && (
            <div className="dc-card-text">Showing {LIST_LIMIT} of {filtered.length}. Search to narrow down.</div>
          )}
          <div className="dc-adhoc">Or leave this empty to draft without a matter.</div>
        </>
      )}
    </section>
  );
}
