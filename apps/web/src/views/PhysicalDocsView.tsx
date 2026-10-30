import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import type { PhysicalDocStatus } from '@lexdraft/types';
import {
  usePhysicalDocuments,
  useDeletePhysicalDocument,
} from '@/hooks/usePhysicalDocuments';
import { NewPhysicalDocModal } from '@/components/NewPhysicalDocModal';
import { Gate } from '@/components/Gate';
import { PageHeader, PageSearch } from '@/components/PageHeader';
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
  in_chambers: { label: 'CHAMBERS',  cls: 'is-solid' },
  court_file:  { label: 'COURT',     cls: 'is-strong' },
  client:      { label: 'CLIENT',    cls: '' },
  co_counsel:  { label: 'CO-COUNSEL', cls: '' },
  archive_box: { label: 'ARCHIVED',  cls: 'is-muted' },
  returned:    { label: 'RETURNED',  cls: 'is-muted' },
  lost:        { label: 'LOST',      cls: 'is-dashed is-strong' },
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
    <div className="col stagger fm-view fm-phys">
      <PageHeader
        title="Physical Docs"
        description="Where each paper original is now, and who has custody of it."
        meta={list.data ? `${items.length} documents` : undefined}
        actions={
          <Gate feature="matter.create">
            <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
              <Icon name="plus" size={14} /> Add document
            </button>
          </Gate>
        }
      >
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search title, file number, matter or location…"
          label="Search physical documents"
        />
      </PageHeader>
      <NewPhysicalDocModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="fm-chips" role="group" aria-label="Filter by where the original is">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
            <span className="fm-count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl fm-tbl">
          <thead>
            <tr>
              <th style={{ width: 120 }}>File no.</th>
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
              <tr><td colSpan={7} data-span="all">
                <ErrorState
                  variant="inline"
                  title="Couldn't load the register"
                  description="Check your connection and try again."
                />
              </td></tr>
            )}
            {!list.isLoading && !list.isError && items.length === 0 && (
              <tr><td colSpan={7} data-span="all">
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
                  <td><span className="fm-code">{d.fileNo}</span></td>
                  <td>
                    <div>
                      <div className="fm-cell-title">{d.title}</div>
                      {d.docType && <div className="fm-cell-sub">{d.docType}</div>}
                    </div>
                  </td>
                  <td>
                    {d.caseLabel ? <span className="fm-matter" style={{ fontSize: 14.5 }}>{d.caseLabel}</span> : <span className="muted">-</span>}
                  </td>
                  <td>
                    <div className="fm-loc"><Icon name="map" size={13} /><span>{d.location}</span></div>
                  </td>
                  <td><span className="fm-custodian">{d.custodian ?? '-'}</span></td>
                  <td><span className={`fm-pill ${badge.cls}`}>{badge.label}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <Gate feature="matter.create">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void onDelete(d.id, d.title)}
                        disabled={remove.isPending}
                      >
                        <Icon name="archive" size={13} /> Archive
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
