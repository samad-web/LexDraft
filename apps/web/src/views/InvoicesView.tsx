import { useMemo, useState } from 'react';
import { Icon, Skeleton, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import type { Invoice, InvoiceStatus } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useInvoices } from '@/hooks/useInvoices';
import { NewInvoiceModal } from '@/components/NewInvoiceModal';
import { InvoiceDetailModal } from '@/components/InvoiceDetailModal';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Gate } from '@/components/Gate';
import { PageHeader, PageSearch } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { apiClient } from '@/lib/api';
import { useSort } from '@/hooks/useSort';
import { useSavedFilter } from '@/hooks/useSavedFilter';

type FilterId = 'all' | InvoiceStatus;
const FILTER_IDS: ReadonlyArray<FilterId> = ['all', 'pending', 'overdue', 'paid'];
type InvoiceSortKey = 'invoiceNo' | 'client' | 'amount' | 'issued' | 'due' | 'status';

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

// label: the PDF register's wording; text + cls: the on-screen pill.
// Overdue is the one that needs action, so it is ink-filled (never red).
const STATUS_BADGE: Record<InvoiceStatus, { label: string; text: string; cls: string }> = {
  paid:    { label: 'PAID',    text: 'Paid',    cls: 'cm-pill cm-pill--soft' },
  pending: { label: 'PENDING', text: 'Pending', cls: 'cm-pill cm-pill--line' },
  overdue: { label: 'OVERDUE', text: 'Overdue', cls: 'cm-pill cm-pill--ink'  },
};

/** "2026-10-28" -> "28 Oct 2026". */
function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "in 12 days" / "18 days overdue" / "Settled" under the due date. */
function relativeDue(inv: Invoice): string {
  if (inv.status === 'paid') return 'Settled';
  const due = new Date(`${inv.dueDate.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(due)) return '';
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days === 0) return 'Due today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} overdue`;
}

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
  const [filter, setFilter] = useSavedFilter<FilterId>('invoices.filter', 'all', (raw) =>
    typeof raw === 'string' && (FILTER_IDS as ReadonlyArray<string>).includes(raw) ? (raw as FilterId) : null,
  );
  const [q, setQ] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
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

  const counts = useMemo<Record<FilterId, number>>(() => {
    const c: Record<FilterId, number> = { all: invoices.length, pending: 0, overdue: 0, paid: 0 };
    for (const inv of invoices) c[inv.status] += 1;
    return c;
  }, [invoices]);

  const filtered = useMemo<ReadonlyArray<Invoice>>(() => {
    const needle = q.trim().toLowerCase();
    return invoices.filter((i) => {
      if (needle && !i.invoiceNo.toLowerCase().includes(needle) && !i.client.toLowerCase().includes(needle)) return false;
      if (filter !== 'all' && i.status !== filter) return false;
      return true;
    });
  }, [invoices, filter, q]);

  const sort = useSort<Invoice, InvoiceSortKey>(filtered, {
    invoiceNo: (r) => r.invoiceNo,
    client:    (r) => r.client,
    amount:    (r) => r.amountInr,
    issued:    (r) => r.issuedDate,
    due:       (r) => r.dueDate,
    status:    (r) => r.status,
  });
  const visible: ReadonlyArray<Invoice> = sort.sorted;

  const pager = usePagination(visible);

  return (
    <div className="col stagger cm-invoices" style={{ gap: 24 }}>
      <PageHeader
        title="Invoices"
        description="Raise invoices, track what clients owe, and export for GST filing."
        actions={<>
        <button
          type="button"
          className="btn"
          disabled={exportingCsv}
          onClick={async () => {
            // GST / Tally-compatible CSV via /api/exports/invoices.csv.
            // Pass the active status filter through so the file matches
            // what the user is looking at. We download via a temporary
            // <a download> link - nothing is stored server-side.
            setExportingCsv(true);
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
            } finally {
              setExportingCsv(false);
            }
          }}
        >
          <Icon name="download" size={14} /> {exportingCsv ? 'Exporting…' : 'Download CSV'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={exportingPdf}
          onClick={async () => {
            if (!visible.length) {
              showToast({ type: 'amber', text: 'No invoices to export' });
              return;
            }
            setExportingPdf(true);
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
            } finally {
              setExportingPdf(false);
            }
          }}
        >
          <Icon name="download" size={14} /> {exportingPdf ? 'Exporting…' : 'Export PDF'}
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
        </>}
      />
      <NewInvoiceModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <Gate feature="billing.invoice">
        <FAB ariaLabel="New invoice" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>
      <InvoiceDetailModal
        open={selected !== null}
        invoice={selected}
        onClose={() => setSelected(null)}
      />

      <div className="cm-kpis" aria-label="Receivables summary">
        <div className="cm-kpi">
          <div className="cm-kpi-label">Total billed</div>
          <div className="cm-kpi-value">₹{formatINR(stats.billed)}</div>
          <div className="cm-kpi-note">{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</div>
        </div>
        <div className="cm-kpi">
          <div className="cm-kpi-label">Outstanding</div>
          <div className="cm-kpi-value">₹{formatINR(stats.outstanding)}</div>
          <div className="cm-kpi-note">Pending and overdue</div>
        </div>
        <div className={`cm-kpi${stats.overdue > 0 ? ' is-alert' : ''}`}>
          <div className="cm-kpi-label">Overdue</div>
          <div className="cm-kpi-value">₹{formatINR(stats.overdue)}</div>
          <div className="cm-kpi-note">
            {counts.overdue > 0
              ? `${counts.overdue} ${counts.overdue === 1 ? 'invoice' : 'invoices'} past due`
              : 'Nothing past due'}
          </div>
        </div>
        <div className="cm-kpi">
          <div className="cm-kpi-label">This month</div>
          <div className="cm-kpi-value">₹{formatINR(stats.thisMonth)}</div>
          <div className="cm-kpi-note">Issued this month</div>
        </div>
      </div>

      <div className="cm-toolbar">
        <div className="cm-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`chip ${filter === f.id ? 'active' : ''}`}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {invoices.length > 0 && <span className="cm-chip-count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search by invoice number or client…"
          label="Search invoices"
        />
      </div>

      <div className="card cm-table-card">
        <table className="tbl">
          <thead>
            <tr>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('invoiceNo')}
                onClick={() => sort.toggle('invoiceNo')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('invoiceNo'); } }}
              >
                Invoice no.
              </th>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('client')}
                onClick={() => sort.toggle('client')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('client'); } }}
              >
                Client
              </th>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('amount')}
                onClick={() => sort.toggle('amount')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('amount'); } }}
                style={{ textAlign: 'right' }}
              >
                Amount
              </th>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('issued')}
                onClick={() => sort.toggle('issued')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('issued'); } }}
              >
                Issued
              </th>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('due')}
                onClick={() => sort.toggle('due')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('due'); } }}
              >
                Due
              </th>
              <th
                className="th-sort"
                data-sort={sort.ariaSort('status')}
                onClick={() => sort.toggle('status')}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort.toggle('status'); } }}
              >
                Status
              </th>
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
                <td colSpan={6} data-span="all">
                  <ErrorState
                    variant="inline"
                    title="Couldn't load invoices"
                    description="Check your connection and try again."
                  />
                </td>
              </tr>
            )}
            {!isLoading && !isError && visible.length === 0 && (
              <tr>
                <td colSpan={6} data-span="all">
                  <div className="cm-empty">
                    <EmptyState
                      variant="inline"
                      title={invoices.length === 0 ? 'No invoices yet' : 'No invoices to show'}
                      description={
                        invoices.length === 0
                          ? 'Bill a client to start tracking AR. New invoices appear here as drafts.'
                          : 'Try a different search or filter.'
                      }
                    />
                  </div>
                </td>
              </tr>
            )}
            {pager.slice.map((inv) => {
              const badge = STATUS_BADGE[inv.status];
              return (
                <tr
                  key={inv.id}
                  className={inv.status === 'overdue' ? 'is-overdue' : undefined}
                  onClick={() => setSelected(inv)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(inv); } }}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono tabular cm-inv-no">{inv.invoiceNo}</td>
                  <td className="cm-client-cell">{inv.client}</td>
                  <td className="cm-num cm-amount">₹{formatINR(inv.amountInr)}</td>
                  <td className="cm-date-cell">{formatDay(inv.issuedDate)}</td>
                  <td className="cm-date-cell">
                    {formatDay(inv.dueDate)}
                    <span className="cm-due-rel">{relativeDue(inv)}</span>
                  </td>
                  <td><span className={badge.cls}>{badge.text}</span></td>
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
