import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import type { PhysicalDocStatus } from '@lexdraft/types';
import {
  usePhysicalDocuments,
  useDeletePhysicalDocument,
} from '@/hooks/usePhysicalDocuments';
import { NewPhysicalDocModal } from '@/components/NewPhysicalDocModal';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { useConfirm } from '@/components/ConfirmDialog';

interface FilterOption {
  id: 'all' | PhysicalDocStatus;
  label: string;
}

const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all',         label: 'All' },
  { id: 'in_chambers', label: 'In chambers' },
  { id: 'court_file',  label: 'Court file' },
  { id: 'client',      label: 'Client' },
  { id: 'co_counsel',  label: 'Co-counsel' },
  { id: 'archive_box', label: 'Archive box' },
  { id: 'returned',    label: 'Returned' },
  { id: 'lost',        label: 'Lost' },
];

const STATUS_BADGE: Record<PhysicalDocStatus, { label: string; cls: string }> = {
  in_chambers: { label: 'CHAMBERS',  cls: 'badge-sage' },
  court_file:  { label: 'COURT',     cls: 'badge-cobalt' },
  client:      { label: 'CLIENT',    cls: 'badge-amber' },
  co_counsel:  { label: 'CO-COUNSEL', cls: 'badge-amber' },
  archive_box: { label: 'ARCHIVED',  cls: 'badge-cream' },
  returned:    { label: 'RETURNED',  cls: 'badge-cream' },
  lost:        { label: 'LOST',      cls: 'badge-vermillion' },
};

/**
 * Register of paper documents the firm holds - vakalatnamas, sworn
 * affidavits, signed contracts, court orders. Distinct from the digital
 * documents register (`/app/documents`), which tracks scans/PDFs in cloud
 * storage.
 */
export function PhysicalDocsView() {
  const [filter, setFilter] = useState<FilterOption['id']>('all');
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const list = usePhysicalDocuments(
    filter === 'all'
      ? (q ? { q } : undefined)
      : (q ? { status: filter, q } : { status: filter }),
  );
  const items = list.data ?? [];
  const pager = usePagination(items);

  const counts = useMemo<Record<FilterOption['id'], number>>(() => {
    const t: Record<FilterOption['id'], number> = {
      all: items.length, in_chambers: 0, court_file: 0, client: 0,
      co_counsel: 0, archive_box: 0, returned: 0, lost: 0,
    };
    for (const it of items) t[it.status] = (t[it.status] ?? 0) + 1;
    return t;
  }, [items]);

  const remove = useDeletePhysicalDocument();
  const confirm = useConfirm();
  async function onDelete(id: string, title: string): Promise<void> {
    const ok = await confirm({
      title: 'Archive document?',
      message: `"${title}" will be removed from the physical-document register.`,
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(id);
  }

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - Physical documents</div>
        <h1 className="heading-xl">Physical Docs</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          Track paper originals - vakalatnamas, sworn affidavits, signed contracts, court orders.
          Each row records where the document is now and who has custody.
        </p>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 360 }}>
          <input
            type="search"
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search title, file number, matter or location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search physical documents"
          />
          <span aria-hidden="true" style={iconAttachStyle}><Icon name="search" size={14} /></span>
        </div>
        <span className="spacer" />
        <Gate feature="matter.create">
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={14} /> Add document
          </button>
        </Gate>
      </div>
      <NewPhysicalDocModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
            <span className="mono tabular" style={{ marginLeft: 8, opacity: 0.7, fontSize: 11 }}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 130 }}>File no.</th>
              <th>Title</th>
              <th>Matter</th>
              <th>Location</th>
              <th>Custodian</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {list.isLoading && Array.from({ length: 5 }, (_, i) => (
              <tr key={`sk-${i}`}>
                <td><Skeleton width={80} height={12} /></td>
                <td><Skeleton width={180} height={14} /></td>
                <td><Skeleton width={140} height={12} /></td>
                <td><Skeleton width={120} height={12} /></td>
                <td><Skeleton width={110} height={12} /></td>
                <td><Skeleton width={70} height={20} /></td>
                <td><Skeleton width={70} height={20} /></td>
              </tr>
            ))}
            {list.isError && (
              <tr><td colSpan={7}>
                <ErrorState
                  variant="inline"
                  title="Couldn't load the register"
                  description="Check your connection and try again."
                />
              </td></tr>
            )}
            {!list.isLoading && !list.isError && items.length === 0 && (
              <tr><td colSpan={7}>
                <EmptyState
                  variant="inline"
                  title={q || filter !== 'all' ? 'No documents match' : 'No physical documents yet'}
                  description={
                    q || filter !== 'all'
                      ? 'Try a different search term or clear the filter.'
                      : 'Click "Add document" to register your first paper original.'
                  }
                />
              </td></tr>
            )}
            {pager.slice.map((d) => {
              const badge = STATUS_BADGE[d.status];
              return (
                <tr key={d.id}>
                  <td className="mono tabular" style={{ fontSize: 12 }}>{d.fileNo}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.title}</div>
                    {d.docType && <div className="muted" style={{ fontSize: 12 }}>{d.docType}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {d.caseLabel ?? <span className="muted">-</span>}
                  </td>
                  <td className="body-sm">{d.location}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{d.custodian ?? '-'}</td>
                  <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                  <td>
                    <Gate feature="matter.create">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void onDelete(d.id, d.title)}
                        disabled={remove.isPending}
                      >
                        Archive
                      </button>
                    </Gate>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        pageSize={pager.pageSize}
        onChange={pager.setPage}
      />
    </div>
  );
}

const iconAttachStyle: React.CSSProperties = {
  position: 'absolute', left: 12, top: '50%',
  transform: 'translateY(-50%)', color: 'var(--text-tertiary)',
  display: 'inline-flex',
};
