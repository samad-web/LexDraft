import { useMemo, useState } from 'react';
import { Icon, Skeleton } from '@lexdraft/ui';
import type { Invoice, InvoiceStatus } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useInvoices } from '@/hooks/useInvoices';
import { NewInvoiceModal } from '@/components/NewInvoiceModal';
import { InvoiceDetailModal } from '@/components/InvoiceDetailModal';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { apiClient } from '@/lib/api';

type FilterId = 'all' | InvoiceStatus;

interface FilterOption {
  id: FilterId;
  label: string;
}

const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all',     label: 'All'     },
  { id: 'pending', label: 'Pending' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid',    label: 'Paid'    },
];

const STATUS_BADGE: Record<InvoiceStatus, { label: string; cls: string }> = {
  paid:    { label: 'PAID',    cls: 'badge-sage'       },
  pending: { label: 'PENDING', cls: 'badge-cobalt'     },
  overdue: { label: 'OVERDUE', cls: 'badge-vermillion' },
};

function formatINR(value: number): string {
  return value.toLocaleString('en-IN');
}

function isThisMonth(issuedIso: string): boolean {
  const now = new Date();
  return (
    issuedIso.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  );
}

export function InvoicesView() {
  const [filter, setFilter] = useState<FilterId>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const showToast = useUIStore((s) => s.showToast);
  const { data: invoices = [], isLoading, isError } = useInvoices();

  const stats = useMemo(() => {
    let billed = 0;
    let outstanding = 0;
    let overdue = 0;
    let thisMonth = 0;
    for (const inv of invoices) {
      billed += inv.amountInr;
      if (inv.status === 'pending') outstanding += inv.amountInr;
      if (inv.status === 'overdue') {
        outstanding += inv.amountInr;
        overdue += inv.amountInr;
      }
      if (isThisMonth(inv.issuedDate)) thisMonth += inv.amountInr;
    }
    return { billed, outstanding, overdue, thisMonth };
  }, [invoices]);

  const visible = useMemo<ReadonlyArray<Invoice>>(
    () => invoices.filter((i) => filter === 'all' || i.status === filter),
    [invoices, filter],
  );

  const pager = usePagination(visible);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Billing register</div>
        <h1 className="heading-xl">Invoices</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            // GST / Tally-compatible CSV via /api/exports/invoices.csv.
            // Pass the active status filter through so the file matches
            // what the user is looking at. We download via a temporary
            // <a download> link - nothing is stored server-side.
            try {
              const params: Record<string, string> = {};
              if (filter !== 'all') params.status = filter;
              const resp = await apiClient.get('/api/exports/invoices.csv', {
                params,
                responseType: 'blob',
              });
              const blob = resp.data instanceof Blob
                ? resp.data
                : new Blob([String(resp.data)], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `lexdraft-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (err) {
              showToast({
                type: 'cobalt',
                text: err instanceof Error ? err.message : 'CSV export failed',
              });
            }
          }}
        >
          <Icon name="download" size={14} /> Download CSV
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (!visible.length) {
              showToast({ type: 'amber', text: 'No invoices to export' });
              return;
            }
            const today = new Date().toISOString().slice(0, 10);
            const rows = visible
              .map((inv) => {
                const badge = STATUS_BADGE[inv.status];
                return `<tr>
                  <td>${escapeReportHtml(inv.invoiceNo)}</td>
                  <td>${escapeReportHtml(inv.client)}</td>
                  <td class="num">₹${formatINR(inv.amountInr)}</td>
                  <td>${escapeReportHtml(inv.issuedDate)}</td>
                  <td>${escapeReportHtml(inv.dueDate)}</td>
                  <td>${badge.label}</td>
                </tr>`;
              })
              .join('');
            const totals = `
              <table style="width:auto;margin-top:18px;">
                <tbody>
                  <tr><th>Total billed</th><td class="num">₹${formatINR(stats.billed)}</td></tr>
                  <tr><th>Outstanding</th><td class="num">₹${formatINR(stats.outstanding)}</td></tr>
                  <tr><th>Overdue</th><td class="num">₹${formatINR(stats.overdue)}</td></tr>
                  <tr><th>This month</th><td class="num">₹${formatINR(stats.thisMonth)}</td></tr>
                </tbody>
              </table>`;
            const html = `
              <p>Filter: <strong>${escapeReportHtml(filter === 'all' ? 'All invoices' : filter)}</strong> · ${visible.length} row${visible.length === 1 ? '' : 's'}</p>
              <table>
                <thead>
                  <tr>
                    <th>Invoice no.</th>
                    <th>Client</th>
                    <th class="num">Amount</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
              ${totals}
            `;
            try {
              await exportPdf({
                title: 'Invoices register',
                bodyHtml: html,
                dated: today,
                disclaimerHtml: null,
                orientation: 'landscape',
              });
            } catch (err) {
              showToast({ type: 'cobalt', text: err instanceof Error ? err.message : 'PDF export failed' });
            }
          }}
        >
          <Icon name="download" size={14} /> Export PDF
        </button>
        <Gate feature="billing.invoice">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> New invoice
          </button>
        </Gate>
      </div>
      <NewInvoiceModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <InvoiceDetailModal
        open={selected !== null}
        invoice={selected}
        onClose={() => setSelected(null)}
      />

      <div className="stat-row">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Total billed</div>
          <div className="heading-lg mono tabular">₹{formatINR(stats.billed)}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Outstanding</div>
          <div className="heading-lg mono tabular" style={{ color: 'var(--info)' }}>
            ₹{formatINR(stats.outstanding)}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Overdue</div>
          <div className="heading-lg mono tabular" style={{ color: 'var(--danger)' }}>
            ₹{formatINR(stats.overdue)}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>This month</div>
          <div className="heading-lg mono tabular">₹{formatINR(stats.thisMonth)}</div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`chip ${filter === f.id ? 'active' : ''}`}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice no.</th>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk-${i}`} aria-busy="true">
                <td><Skeleton width={88} height={14} /></td>
                <td><Skeleton width={140} height={14} /></td>
                <td style={{ textAlign: 'right' }}><Skeleton width={70} height={14} /></td>
                <td><Skeleton width={86} height={12} /></td>
                <td><Skeleton width={86} height={12} /></td>
                <td><Skeleton width={64} height={20} radius="pill" /></td>
              </tr>
            ))}
            {isError && !isLoading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--danger)' }}>
                  Couldn’t load invoices.
                </td>
              </tr>
            )}
            {!isLoading && !isError && visible.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                    <div className="heading-sm">{invoices.length === 0 ? 'No invoices yet' : 'No invoices to show'}</div>
                    <p className="body-sm muted">{invoices.length === 0 ? 'Use “New invoice” to add one.' : 'Try a different status filter.'}</p>
                  </div>
                </td>
              </tr>
            )}
            {pager.slice.map((inv) => {
              const badge = STATUS_BADGE[inv.status];
              return (
                <tr
                  key={inv.id}
                  onClick={() => setSelected(inv)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono tabular" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {inv.invoiceNo}
                  </td>
                  <td>{inv.client}</td>
                  <td className="mono tabular" style={{ textAlign: 'right', fontWeight: 500 }}>
                    ₹{formatINR(inv.amountInr)}
                  </td>
                  <td className="mono tabular muted">{inv.issuedDate}</td>
                  <td className="mono tabular muted">{inv.dueDate}</td>
                  <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          pageSize={pager.pageSize}
          onChange={pager.setPage}
        />
      </div>
    </div>
  );
}
