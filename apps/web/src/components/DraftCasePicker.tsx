import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCases, useSyncCaseFromEcourts } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { caseToContext, type DraftCaseContext } from '@/lib/draft-case-context';

interface Props {
  selected: DraftCaseContext | null;
  onSelect: (ctx: DraftCaseContext | null) => void;
}

/**
 * Case picker + eCourts sync for the Draft screen. The advocate attaches a
 * matter so the agent drafts against the real court/CNR/parties — or leaves it
 * on "No case" for an ad-hoc draft. "Sync from eCourts" refreshes the selected
 * matter's record before drafting so the particulars are current.
 */
export function DraftCasePicker({ selected, onSelect }: Props) {
  const { data: cases = [], isLoading } = useCases();
  const sync = useSyncCaseFromEcourts();
  const showToast = useUIStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
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
    <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="cases" size={15} />
        <span className="heading-sm">Attach a case</span>
        <span className="body-xs muted" style={{ flex: 1, minWidth: 120 }}>
          The agent drafts against the real court, CNR and parties.
        </span>

        {selected ? (
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-cobalt" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.title}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onSync}
              disabled={sync.isPending}
              title="Refresh this matter from eCourts before drafting"
            >
              <Icon name="ecourts" size={12} /> {sync.isPending ? 'Syncing…' : 'Sync from eCourts'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(null)} title="Remove case">
              <Icon name="close" size={12} /> Detach
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
            <Icon name="plus" size={12} /> Select case
          </button>
        )}
      </div>

      {!selected && open && (
        <div className="col" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Search by title, CNR or client…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {isLoading && <span className="body-sm muted" style={{ padding: 8 }}>Loading cases…</span>}
            {!isLoading && filtered.length === 0 && (
              <span className="body-sm muted" style={{ padding: 8 }}>
                No matters found. Open a case from Cases first, or draft without one.
              </span>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="row-clickable"
                onClick={() => { onSelect(caseToContext(c)); setOpen(false); setQ(''); }}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 500, fontSize: 13 }}>{c.title}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {c.cnr} · {c.court || 'court not set'} · {c.client}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
